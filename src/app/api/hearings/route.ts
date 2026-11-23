import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, officeRoles, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { ammanDayStart } from "@/lib/dates";

const fields = {
  startsAt: z.string().datetime(),
  courtroom: z.string().trim().max(120).optional(),
  judge: z.string().trim().max(120).optional(),
  purpose: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  decision: z.string().trim().max(2000).optional(),
  nextStartsAt: z.string().datetime().nullable().optional(),
};
const createSchema = z.object({ caseId: z.string().min(1), ...fields });
const updateSchema = z.object(fields).partial();

const dates = <T extends { startsAt?: string; nextStartsAt?: string | null }>(value: T) => ({
  ...value,
  ...(value.startsAt ? { startsAt: new Date(value.startsAt) } : {}),
  ...(value.nextStartsAt ? { nextStartsAt: new Date(value.nextStartsAt) } : {}),
});

export const GET = route(staffRoles, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const hearings = await withDatabaseAccess(user, (tx) =>
    tx.hearing.findMany({
      where: {
        deletedAt: null,
        legalCase: { deletedAt: null },
        startsAt: { gte: from ? new Date(from) : ammanDayStart(), ...(to ? { lt: new Date(to) } : {}) },
      },
      include: { legalCase: { select: { id: true, caseNumber: true, title: true, court: true, courtCity: true, client: { select: { name: true } } } } },
      orderBy: { startsAt: "asc" },
      take: 200,
    }),
  );
  return { hearings };
});

export const POST = route(officeRoles, async (user, request) => {
  const input = await parseBody(request, createSchema, "راجع تاريخ الجلسة وبياناتها.");
  const hearing = await withDatabaseAccess(user, async (tx) => {
    const legalCase = await tx.legalCase.findFirst({ where: { id: input.caseId, deletedAt: null }, select: { id: true } });
    return legalCase ? tx.hearing.create({ data: dates(input) }) : null;
  });
  if (!hearing) throw new HttpError("القضية غير موجودة أو غير متاحة.", 404);
  await logAudit(user, "HEARING_CREATED", "Hearing", hearing.id, { startsAt: hearing.startsAt.toISOString() }, hearing.caseId);
  return NextResponse.json({ hearing }, { status: 201 });
});

export const PATCH = route(officeRoles, async (user, request) => {
  const id = requireId(request);
  const input = await parseBody(request, updateSchema, "راجع بيانات الجلسة.");
  const hearing = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.hearing.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    return existing ? tx.hearing.update({ where: { id }, data: dates(input) }) : null;
  });
  if (!hearing) throw new HttpError("الجلسة غير موجودة.", 404);
  await logAudit(user, "HEARING_UPDATED", "Hearing", id, { fields: Object.keys(input) }, hearing.caseId);
  return { hearing };
});

export const DELETE = route(officeRoles, async (user, request) => {
  const id = requireId(request);
  const hearing = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.hearing.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new HttpError("الجلسة غير موجودة.", 404);
    return tx.hearing.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  await logAudit(user, "HEARING_DELETED", "Hearing", id, undefined, hearing.caseId);
  return { ok: true };
});
