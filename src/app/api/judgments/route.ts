import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { ammanDayKey } from "@/lib/dates";
import { proposeDeadline, ruleApplies, type Closure, type RuleInput } from "@/lib/deadlines";

const fields = {
  judgmentNumber: z.string().trim().max(80).optional(),
  title: z.string().trim().min(2).max(200),
  court: z.string().trim().max(120).optional(),
  decidedAt: z.string().datetime(),
  summary: z.string().trim().min(2).max(5000),
  notifiedAt: z.string().datetime().nullable().optional(),
  appealFiledAt: z.string().datetime().nullable().optional(),
  // A deadline typed by the lawyer is final; a rule only ever produces a proposal to confirm.
  appealDeadline: z.string().datetime().nullable().optional(),
  ruleId: z.string().optional(),
};
const createSchema = z.object({ caseId: z.string().min(1), ...fields });
const updateSchema = z.object({ ...fields, action: z.enum(["confirmDeadline", "dismissDeadline"]).optional() }).partial();

const dates = (value: { decidedAt?: string; appealDeadline?: string | null; notifiedAt?: string | null; appealFiledAt?: string | null }) => ({
  ...(value.decidedAt ? { decidedAt: new Date(value.decidedAt) } : {}),
  ...(value.appealDeadline ? { appealDeadline: new Date(value.appealDeadline) } : {}),
  ...(value.notifiedAt ? { notifiedAt: new Date(value.notifiedAt) } : {}),
  ...(value.appealFiledAt ? { appealFiledAt: new Date(value.appealFiledAt) } : {}),
});

async function proposal(tx: Prisma.TransactionClient, ruleId: string, caseId: string, decidedAt: Date, notifiedAt?: Date | null) {
  const rule = await tx.deadlineRule.findFirst({ where: { id: ruleId, active: true, deletedAt: null } });
  if (!rule) throw new HttpError("قاعدة الموعد غير موجودة.");
  const legalCase = await tx.legalCase.findFirstOrThrow({ where: { id: caseId }, select: { type: true, court: true } });
  if (!ruleApplies(rule, legalCase.type, legalCase.court)) throw new HttpError("هذه القاعدة لا تنطبق على نوع القضية أو درجة المحكمة.");
  const closures = await tx.holiday.findMany({ select: { name: true, startsOn: true, endsOn: true, kind: true } });
  const result = proposeDeadline(rule as RuleInput, decidedAt, notifiedAt, closures.map((row) => ({ name: row.name, from: row.startsOn, to: row.endsOn, kind: row.kind }) satisfies Closure));
  if (!result) throw new HttpError("تعتمد هذه القاعدة على تاريخ التبليغ. أدخله أولاً.");
  return {
    proposedDeadline: result.deadline,
    deadlineRule: result.snapshot as unknown as Prisma.InputJsonValue,
    deadlineConfirmedBy: null,
    deadlineConfirmedAt: null,
  };
}

/** The responsible lawyer gets one task per deadline, moved whenever the deadline changes. */
async function deadlineTask(tx: Prisma.TransactionClient, judgment: { id: string; caseId: string; title: string; appealDeadline: Date | null; appealFiledAt: Date | null }) {
  if (!judgment.appealDeadline || judgment.appealFiledAt) return;
  const legalCase = await tx.legalCase.findFirstOrThrow({ where: { id: judgment.caseId }, select: { caseNumber: true, assignedLawyerId: true } });
  const title = `آخر يوم للطعن في «${judgment.title}» — القضية ${legalCase.caseNumber}`;
  await tx.task.upsert({
    where: { judgmentId: judgment.id },
    create: { judgmentId: judgment.id, title, caseId: judgment.caseId, assigneeId: legalCase.assignedLawyerId, dueAt: judgment.appealDeadline, priority: "HIGH" },
    update: { title, dueAt: judgment.appealDeadline, completedAt: null, deletedAt: null },
  });
}

export const GET = route(staffRoles, async (user) => {
  const judgments = await withDatabaseAccess(user, (tx) =>
    tx.judgment.findMany({
      where: { deletedAt: null, legalCase: { deletedAt: null } },
      include: { legalCase: { select: { id: true, caseNumber: true, title: true, client: { select: { name: true } } } } },
      orderBy: { decidedAt: "desc" },
    }),
  );
  return { judgments };
});

export const POST = route([Role.SENIOR_LAWYER], async (user, request) => {
  const input = await parseBody(request, createSchema, "راجع بيانات الحكم.");
  const { ruleId, caseId, appealDeadline, decidedAt, notifiedAt, appealFiledAt, ...rest } = input;
  const parsedDates = dates({ decidedAt, appealDeadline, notifiedAt, appealFiledAt });
  const judgment = await withDatabaseAccess(user, async (tx) => {
    const legalCase = await tx.legalCase.findFirst({ where: { id: caseId, deletedAt: null }, select: { id: true } });
    if (!legalCase) return null;
    const proposed = ruleId ? await proposal(tx, ruleId, caseId, new Date(decidedAt), parsedDates.notifiedAt) : {};
    const created = await tx.judgment.create({
      data: {
        ...rest, ...parsedDates, ...proposed, caseId, decidedAt: new Date(decidedAt),
        ...(appealDeadline ? { deadlineConfirmedBy: user.id, deadlineConfirmedAt: new Date() } : {}),
      },
    });
    await deadlineTask(tx, created);
    return created;
  });
  if (!judgment) throw new HttpError("القضية غير موجودة.", 404);
  await logAudit(user, "JUDGMENT_CREATED", "Judgment", judgment.id, undefined, judgment.caseId);
  return NextResponse.json({ judgment }, { status: 201 });
});

export const PATCH = route([Role.SENIOR_LAWYER], async (user, request) => {
  const id = requireId(request);
  const input = await parseBody(request, updateSchema, "راجع بيانات الحكم.");
  const { ruleId, action, decidedAt, appealDeadline, notifiedAt, appealFiledAt, ...rest } = input;
  const judgment = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.judgment.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new HttpError("الحكم غير موجود.", 404);
    if (action === "confirmDeadline") {
      if (!existing.proposedDeadline) throw new HttpError("لا يوجد موعد مقترح لتأكيده.", 409);
      const confirmed = await tx.judgment.update({ where: { id }, data: { appealDeadline: existing.proposedDeadline, proposedDeadline: null, deadlineConfirmedBy: user.id, deadlineConfirmedAt: new Date() } });
      await deadlineTask(tx, confirmed);
      return confirmed;
    }
    if (action === "dismissDeadline") {
      return tx.judgment.update({ where: { id }, data: { proposedDeadline: null, deadlineRule: Prisma.DbNull } });
    }
    const parsedDates = dates({ decidedAt, appealDeadline, notifiedAt, appealFiledAt });
    const proposed = ruleId ? await proposal(tx, ruleId, existing.caseId, parsedDates.decidedAt ?? existing.decidedAt, parsedDates.notifiedAt ?? existing.notifiedAt) : {};
    const updated = await tx.judgment.update({
      where: { id },
      data: { ...rest, ...parsedDates, ...proposed, ...(appealDeadline ? { deadlineConfirmedBy: user.id, deadlineConfirmedAt: new Date() } : {}) },
    });
    await deadlineTask(tx, updated);
    if (updated.appealFiledAt) await tx.task.updateMany({ where: { judgmentId: id, completedAt: null }, data: { completedAt: new Date() } });
    return updated;
  });
  await logAudit(user, action ? `JUDGMENT_${action.toUpperCase()}` : "JUDGMENT_UPDATED", "Judgment", id, { fields: Object.keys(input), on: ammanDayKey() }, judgment.caseId);
  return { judgment };
});

export const DELETE = route([Role.SENIOR_LAWYER], async (user, request) => {
  const id = requireId(request);
  const judgment = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.judgment.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new HttpError("الحكم غير موجود.", 404);
    return tx.judgment.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  await logAudit(user, "JUDGMENT_DELETED", "Judgment", id, undefined, judgment.caseId);
  return { ok: true };
});
