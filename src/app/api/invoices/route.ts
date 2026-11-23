import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, parseBody, requireId, route } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { timeValueCents } from "@/lib/billing";

const senior = [Role.SENIOR_LAWYER];
const money = z.number().positive().max(100_000_000);
const installmentSchema = z.object({
  amount: money,
  dueAt: z.string().datetime(),
  method: z.string().trim().max(60).optional(),
  chequeNumber: z.string().trim().max(60).optional(),
  chequeBank: z.string().trim().max(120).optional(),
  chequeDrawer: z.string().trim().max(160).optional(),
}).refine((row) => row.method !== "شيك" || (row.chequeNumber && row.chequeBank));
const installmentsSchema = z.array(installmentSchema).min(2).max(60);
type InstallmentInput = z.infer<typeof installmentSchema>;
const invoiceSchema = z.object({
  caseId: z.string().min(1),
  // Left empty, the number is generated and the amount is the case's unbilled fees.
  number: z.string().trim().min(1).max(60).optional(),
  // The fees part; zero is allowed when the invoice only bills expenses or hours.
  amount: z.number().min(0).max(100_000_000).optional(),
  includeExpenses: z.boolean().optional(),
  hourlyRate: z.number().positive().max(100_000).optional(),
  issuedAt: z.string().datetime(),
  dueAt: z.string().datetime().optional(),
  notes: z.string().trim().max(1000).optional(),
  installments: installmentsSchema.optional(),
});
const paymentSchema = z.object({
  amount: money,
  paidAt: z.string().datetime(),
  method: z.string().trim().max(60).optional(),
  chequeNumber: z.string().trim().min(1).max(60).optional(),
  chequeBank: z.string().trim().min(1).max(120).optional(),
  chequeDrawer: z.string().trim().max(160).optional(),
  chequeDueAt: z.string().datetime().optional(),
}).refine((value) => value.method !== "شيك" || (value.chequeNumber && value.chequeBank && value.chequeDueAt));
const scheduleSchema = z.object({ installments: z.union([installmentsSchema, z.array(z.never()).length(0)]) });

const cents = (value: number) => Math.round(value * 100);

/** Installments must add up to the invoice exactly; they are stored in date order. */
function checkInstallments(installments: InstallmentInput[], amount: number) {
  const total = installments.reduce((sum, row) => sum + cents(row.amount), 0);
  if (total !== cents(amount)) throw new HttpError(`مجموع الدفعات (${(total / 100).toFixed(2)}) لا يساوي مبلغ الفاتورة (${amount.toFixed(2)}).`);
  return installments
    .map((row) => {
      const cheque = row.method === "شيك";
      return {
        amount: row.amount,
        dueAt: new Date(row.dueAt),
        method: row.method || null,
        // Cheque details only belong to an installment paid by cheque.
        chequeNumber: cheque ? row.chequeNumber : null,
        chequeBank: cheque ? row.chequeBank : null,
        chequeDrawer: cheque ? row.chequeDrawer || null : null,
      };
    })
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

type StoredInstallment = { id: string; amount: Prisma.Decimal; dueAt: Date; method: string | null; chequeNumber: string | null; chequeBank: string | null; chequeDrawer: string | null };

/** Payments settle installments oldest first, so each installment's state follows from the total paid. */
function settle(installments: StoredInstallment[], paid: number) {
  let left = cents(paid);
  const today = Date.now();
  return installments.map((row) => {
    const amount = cents(Number(row.amount));
    const covered = Math.min(amount, Math.max(left, 0));
    left -= covered;
    const status = covered >= amount ? "PAID" : row.dueAt.getTime() < today ? "OVERDUE" : covered > 0 ? "PARTIAL" : "PENDING";
    return { id: row.id, amount: amount / 100, paid: covered / 100, dueAt: row.dueAt, status, method: row.method, chequeNumber: row.chequeNumber, chequeBank: row.chequeBank, chequeDrawer: row.chequeDrawer };
  });
}

async function nextNumber(tx: Prisma.TransactionClient) {
  const prefix = `INV-${new Date().getFullYear()}-`;
  let sequence = (await tx.invoice.count({ where: { number: { startsWith: prefix } } })) + 1;
  while (await tx.invoice.findUnique({ where: { number: `${prefix}${String(sequence).padStart(3, "0")}` }, select: { id: true } })) sequence += 1;
  return `${prefix}${String(sequence).padStart(3, "0")}`;
}

const unbilled = (caseId: string) => ({ caseId, billable: true, invoiceId: null });

/** What the case's agreed fees leave to bill after every live invoice, plus its unbilled expenses and hours. */
async function unbilledFees(tx: Prisma.TransactionClient, caseId: string) {
  const legalCase = await tx.legalCase.findFirst({ where: { id: caseId, deletedAt: null }, select: { fees: true } });
  if (!legalCase) throw new HttpError("القضية غير موجودة.", 404);
  const [invoiced, expenses, time] = await Promise.all([
    tx.invoice.aggregate({ where: { caseId, deletedAt: null }, _sum: { amount: true, extrasAmount: true } }),
    tx.caseExpense.aggregate({ where: unbilled(caseId), _sum: { amount: true } }),
    tx.timeEntry.aggregate({ where: unbilled(caseId), _sum: { minutes: true } }),
  ]);
  // Expenses and hours billed earlier are not part of the agreed fees.
  const billed = Number(invoiced._sum.amount ?? 0) - Number(invoiced._sum.extrasAmount ?? 0);
  const fees = legalCase.fees === null ? null : Number(legalCase.fees);
  return {
    fees,
    billed,
    remaining: fees === null ? null : Math.max(fees - billed, 0),
    unbilledExpenses: Number(expenses._sum.amount ?? 0),
    unbilledMinutes: time._sum.minutes ?? 0,
  };
}

export const GET = route(senior, async (user, request) => {
  const caseId = request.nextUrl.searchParams.get("fees");
  if (caseId) return withDatabaseAccess(user, (tx) => unbilledFees(tx, caseId));
  const invoices = await withDatabaseAccess(user, (tx) =>
    tx.invoice.findMany({
      where: { deletedAt: null },
      include: {
        payments: { orderBy: { paidAt: "desc" } },
        installments: { orderBy: { dueAt: "asc" } },
        legalCase: { select: { id: true, caseNumber: true, client: { select: { name: true } } } },
      },
      orderBy: { issuedAt: "desc" },
    }),
  );
  return {
    invoices: invoices.map(({ installments, ...invoice }) => {
      const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const schedule = settle(installments, paid);
      return {
        ...invoice,
        amount: Number(invoice.amount),
        paid,
        balance: Number(invoice.amount) - paid,
        payments: invoice.payments.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
        installments: schedule,
        nextInstallment: schedule.find((row) => row.status !== "PAID") ?? null,
      };
    }),
  };
});

export const POST = route(senior, async (user, request) => {
  const invoiceId = request.nextUrl.searchParams.get("payment");
  if (invoiceId) {
    const parsed = await parseBody(request, paymentSchema, "راجع مبلغ الدفعة وتاريخها، ورقم الشيك والبنك وتاريخ استحقاقه إذا كان الدفع بشيك.");
    // Cheque fields only belong to a cheque payment.
    const input = parsed.method === "شيك"
      ? { ...parsed, chequeDueAt: new Date(parsed.chequeDueAt as string) }
      : { amount: parsed.amount, paidAt: parsed.paidAt, method: parsed.method };
    const payment = await withDatabaseAccess(user, async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, deletedAt: null }, include: { payments: true } });
      if (!invoice) throw new HttpError("الفاتورة غير موجودة.", 404);
      const paid = invoice.payments.reduce((sum, row) => sum + Number(row.amount), 0);
      if (paid + input.amount > Number(invoice.amount) + 0.001) throw new HttpError("الدفعة تتجاوز المبلغ المستحق.");
      await tx.auditLog.create({ data: { userId: user.id, action: "PAYMENT_RECORDED", entityType: "Invoice", entityId: invoiceId, caseId: invoice.caseId, details: { amount: input.amount, method: input.method ?? null } } });
      return tx.payment.create({ data: { ...input, invoiceId, paidAt: new Date(input.paidAt) } });
    });
    return NextResponse.json({ payment }, { status: 201 });
  }
  const { installments, includeExpenses, hourlyRate, ...input } = await parseBody(request, invoiceSchema, "راجع بيانات الفاتورة، ورقم الشيك والبنك لكل دفعة بشيك.");
  const invoice = await withDatabaseAccess(user, async (tx) => {
    if (input.number && (await tx.invoice.findUnique({ where: { number: input.number }, select: { id: true } }))) throw new HttpError("رقم الفاتورة مستخدم.", 409);
    const fees = await unbilledFees(tx, input.caseId);
    // Lock in exactly the rows priced here, so a row added meanwhile is not billed unpriced.
    const expenses = includeExpenses ? await tx.caseExpense.findMany({ where: unbilled(input.caseId), select: { id: true, amount: true } }) : [];
    const hours = hourlyRate ? await tx.timeEntry.findMany({ where: unbilled(input.caseId), select: { id: true, minutes: true } }) : [];
    const extrasCents = expenses.reduce((sum, row) => sum + cents(Number(row.amount)), 0)
      // Priced on the total time, as the invoice form shows it.
      + timeValueCents(hours.reduce((sum, row) => sum + row.minutes, 0), hourlyRate ?? 0);
    const base = input.amount ?? ((includeExpenses || hourlyRate) ? 0 : fees.remaining ?? 0);
    const amount = (cents(base) + extrasCents) / 100;
    if (!amount) {
      if (includeExpenses || hourlyRate) throw new HttpError("لا توجد مصاريف أو ساعات غير مفوترة في هذه القضية، ولا مبلغ أتعاب.");
      throw new HttpError(fees.fees === null ? "لا توجد أتعاب مسجلة في هذه القضية. أدخل مبلغ الفاتورة أو سجّل الأتعاب في القضية." : "أتعاب القضية مفوترة بالكامل. أدخل المبلغ يدوياً لفاتورة إضافية.");
    }
    const schedule = installments ? checkInstallments(installments, amount) : [];
    const lines = [
      expenses.length ? `مصاريف: ${(expenses.reduce((sum, row) => sum + cents(Number(row.amount)), 0) / 100).toFixed(2)}` : "",
      hours.length ? `ساعات عمل: ${(hours.reduce((sum, row) => sum + row.minutes, 0) / 60).toFixed(2)} ساعة × ${hourlyRate}` : "",
    ].filter(Boolean);
    const created = await tx.invoice.create({
      data: {
        caseId: input.caseId,
        number: input.number ?? (await nextNumber(tx)),
        amount,
        extrasAmount: extrasCents / 100,
        notes: [input.notes, ...lines].filter(Boolean).join("\n") || undefined,
        issuedAt: new Date(input.issuedAt),
        // With installments, the invoice falls due with the last one.
        dueAt: schedule.length ? schedule[schedule.length - 1].dueAt : input.dueAt ? new Date(input.dueAt) : undefined,
        installments: schedule.length ? { create: schedule } : undefined,
      },
    });
    if (expenses.length) await tx.caseExpense.updateMany({ where: { id: { in: expenses.map((row) => row.id) } }, data: { invoiceId: created.id } });
    if (hours.length) await tx.timeEntry.updateMany({ where: { id: { in: hours.map((row) => row.id) } }, data: { invoiceId: created.id } });
    return created;
  });
  await logAudit(user, "INVOICE_CREATED", "Invoice", invoice.id, { number: invoice.number, installments: installments?.length ?? 0 }, invoice.caseId);
  return NextResponse.json({ invoice }, { status: 201 });
});

/** Replaces an invoice's installment plan; an empty plan turns it back into a single payment. */
export const PUT = route(senior, async (user, request) => {
  const id = requireId(request);
  const input = await parseBody(request, scheduleSchema, "راجع مبالغ الدفعات وتواريخها، ورقم الشيك والبنك لكل دفعة بشيك.");
  const invoice = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.invoice.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new HttpError("الفاتورة غير موجودة.", 404);
    const schedule = input.installments.length ? checkInstallments(input.installments, Number(existing.amount)) : [];
    await tx.invoiceInstallment.deleteMany({ where: { invoiceId: id } });
    if (schedule.length) await tx.invoiceInstallment.createMany({ data: schedule.map((row) => ({ ...row, invoiceId: id })) });
    return tx.invoice.update({ where: { id }, data: { dueAt: schedule.length ? schedule[schedule.length - 1].dueAt : existing.dueAt } });
  });
  await logAudit(user, "INVOICE_SCHEDULED", "Invoice", id, { installments: input.installments.length }, invoice.caseId);
  return { ok: true };
});

export const DELETE = route(senior, async (user, request) => {
  const id = requireId(request);
  const invoice = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.invoice.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new HttpError("الفاتورة غير موجودة.", 404);
    // Expenses and hours on a deleted invoice become billable again.
    await tx.caseExpense.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    await tx.timeEntry.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    return tx.invoice.update({ where: { id }, data: { deletedAt: new Date(), extrasAmount: 0 } });
  });
  await logAudit(user, "INVOICE_DELETED", "Invoice", id, undefined, invoice.caseId);
  return { ok: true };
});
