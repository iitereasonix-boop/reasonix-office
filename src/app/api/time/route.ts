import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";

const schema = z.object({
  caseId: z.string().min(1),
  minutes: z.number().int().positive().max(24 * 60),
  workedAt: z.string().datetime(),
  description: z.string().trim().min(2).max(500),
  billable: z.boolean().default(true),
});

/** Row-level security limits everyone but the senior lawyer to their own hours. */
export const GET = route(staffRoles, async (user, request) => {
  const caseId = request.nextUrl.searchParams.get("caseId");
  const entries = await withDatabaseAccess(user, (tx) =>
    tx.timeEntry.findMany({
      where: caseId ? { caseId } : { legalCase: { deletedAt: null } },
      include: {
        user: { select: { name: true } },
        invoice: { select: { number: true, deletedAt: true } },
        legalCase: { select: { id: true, caseNumber: true, client: { select: { name: true } } } },
      },
      orderBy: { workedAt: "desc" },
      take: caseId ? undefined : 500,
    }),
  );
  return {
    entries: entries.map(({ invoice, ...row }) => ({ ...row, invoiceNumber: invoice && !invoice.deletedAt ? invoice.number : null })),
  };
});

export const POST = route(staffRoles, async (user, request) => {
  const input = await parseBody(request, schema, "أدخل المدة (حتى 24 ساعة) والتاريخ ووصف العمل.");
  const entry = await withDatabaseAccess(user, async (tx) => {
    const legalCase = await tx.legalCase.findFirst({ where: { id: input.caseId, deletedAt: null }, select: { id: true } });
    if (!legalCase) throw new HttpError("القضية غير موجودة.", 404);
    return tx.timeEntry.create({ data: { ...input, workedAt: new Date(input.workedAt), userId: user.id } });
  });
  await logAudit(user, "TIME_LOGGED", "TimeEntry", entry.id, { minutes: input.minutes }, input.caseId);
  return NextResponse.json({ entry }, { status: 201 });
});

export const DELETE = route(staffRoles, async (user, request) => {
  const id = requireId(request);
  const entry = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.timeEntry.findUnique({ where: { id }, include: { invoice: { select: { deletedAt: true } } } });
    if (!existing) throw new HttpError("السجل غير موجود.", 404);
    if (existing.invoice && !existing.invoice.deletedAt) throw new HttpError("الساعات مفوترة. احذف الفاتورة أولاً.", 409);
    if (user.role !== Role.SENIOR_LAWYER && existing.userId !== user.id) throw new HttpError("تحذف ساعاتك أنت فقط.", 403);
    await tx.timeEntry.delete({ where: { id } });
    return existing;
  });
  await logAudit(user, "TIME_DELETED", "TimeEntry", id, { minutes: entry.minutes }, entry.caseId);
  return { ok: true };
});
