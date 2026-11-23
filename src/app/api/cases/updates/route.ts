import { NextResponse } from "next/server";
import { CaseStatus, Role, UpdateKind } from "@prisma/client";
import { z } from "zod";
import { HttpError, officeRoles, parseBody, route } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";

const schema = z.object({
  caseId: z.string().min(1),
  kind: z.nativeEnum(UpdateKind),
  occurredAt: z.string().datetime(),
  note: z.string().trim().min(2).max(3000),
  nextHearingAt: z.string().datetime().optional(),
  status: z.nativeEnum(CaseStatus).optional(),
});

/** Records what happened, then moves the next hearing and status in the same transaction. */
export const POST = route(officeRoles, async (user, request) => {
  const input = await parseBody(request, schema, "راجع نوع التحديث وتاريخه والملاحظة.");
  if (input.status && user.role !== Role.SENIOR_LAWYER) throw new HttpError("تغيير حالة القضية للمحامي صاحب المكتب فقط.", 403);
  const nextHearingAt = input.nextHearingAt ? new Date(input.nextHearingAt) : null;
  const update = await withDatabaseAccess(user, async (tx) => {
    const legalCase = await tx.legalCase.findFirst({ where: { id: input.caseId, deletedAt: null }, select: { id: true } });
    if (!legalCase) throw new HttpError("القضية غير موجودة أو غير متاحة لك.", 404);
    const created = await tx.caseUpdate.create({
      data: { caseId: input.caseId, kind: input.kind, occurredAt: new Date(input.occurredAt), note: input.note, nextHearingAt, createdById: user.id },
    });
    if (nextHearingAt) {
      const latest = await tx.hearing.findFirst({ where: { caseId: input.caseId, deletedAt: null, startsAt: { lte: new Date(input.occurredAt) } }, orderBy: { startsAt: "desc" }, select: { id: true } });
      if (latest) await tx.hearing.update({ where: { id: latest.id }, data: { nextStartsAt: nextHearingAt, notes: input.note } });
      await tx.hearing.create({ data: { caseId: input.caseId, startsAt: nextHearingAt, purpose: "جلسة تالية" } });
    }
    if (input.status) await tx.legalCase.update({ where: { id: input.caseId }, data: { status: input.status } });
    return created;
  });
  await logAudit(user, "CASE_UPDATE_ADDED", "CaseUpdate", update.id, { kind: input.kind, nextHearing: Boolean(nextHearingAt), status: input.status }, input.caseId);
  return NextResponse.json({ update }, { status: 201 });
});
