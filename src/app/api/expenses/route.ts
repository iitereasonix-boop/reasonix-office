import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, officeRoles, parseBody, requireId, route } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { EXPENSE_CATEGORIES } from "@/lib/billing";

const schema = z.object({
  caseId: z.string().min(1),
  amount: z.number().positive().max(100_000_000),
  spentAt: z.string().datetime(),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().max(500).optional(),
  billable: z.boolean().default(true),
});

export const GET = route(officeRoles, async (user, request) => {
  const caseId = request.nextUrl.searchParams.get("caseId");
  const expenses = await withDatabaseAccess(user, (tx) =>
    tx.caseExpense.findMany({
      where: caseId ? { caseId } : { legalCase: { deletedAt: null } },
      include: {
        createdBy: { select: { name: true } },
        invoice: { select: { number: true, deletedAt: true } },
        legalCase: { select: { id: true, caseNumber: true, client: { select: { name: true } } } },
      },
      orderBy: { spentAt: "desc" },
      take: caseId ? undefined : 500,
    }),
  );
  return {
    expenses: expenses.map(({ invoice, ...row }) => ({
      ...row,
      amount: Number(row.amount),
      invoiceNumber: invoice && !invoice.deletedAt ? invoice.number : null,
    })),
  };
});

export const POST = route(officeRoles, async (user, request) => {
  const input = await parseBody(request, schema, "راجع مبلغ المصروف وتاريخه ونوعه.");
  const expense = await withDatabaseAccess(user, async (tx) => {
    const legalCase = await tx.legalCase.findFirst({ where: { id: input.caseId, deletedAt: null }, select: { id: true } });
    if (!legalCase) throw new HttpError("القضية غير موجودة.", 404);
    return tx.caseExpense.create({
      data: { ...input, description: input.description || null, spentAt: new Date(input.spentAt), createdById: user.id },
    });
  });
  await logAudit(user, "EXPENSE_CREATED", "CaseExpense", expense.id, { amount: input.amount, category: input.category }, input.caseId);
  return NextResponse.json({ expense }, { status: 201 });
});

export const DELETE = route(officeRoles, async (user, request) => {
  const id = requireId(request);
  const expense = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.caseExpense.findUnique({ where: { id }, include: { invoice: { select: { deletedAt: true } } } });
    if (!existing) throw new HttpError("المصروف غير موجود.", 404);
    if (existing.invoice && !existing.invoice.deletedAt) throw new HttpError("المصروف مفوتر. احذف الفاتورة أولاً.", 409);
    if (user.role !== Role.SENIOR_LAWYER && existing.createdById !== user.id) throw new HttpError("تحذف ما سجّلته أنت فقط.", 403);
    await tx.caseExpense.delete({ where: { id } });
    return existing;
  });
  await logAudit(user, "EXPENSE_DELETED", "CaseExpense", id, { amount: Number(expense.amount) }, expense.caseId);
  return { ok: true };
});
