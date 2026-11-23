import { NextResponse } from "next/server";
import { CaseStatus, CaseType, CourtLevel, Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess, type SafeUser } from "@/lib/auth";
import { maskId, seal, unseal } from "@/lib/crypto";
import { conflictsFor } from "@/lib/conflicts";

const createSchema = z.object({
  caseNumber: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(200),
  type: z.nativeEnum(CaseType),
  court: z.nativeEnum(CourtLevel),
  courtCity: z.string().trim().max(80).optional(),
  summary: z.string().trim().max(3000).optional(),
  mojCourt: z.string().trim().max(120).optional(),
  mojJurisdiction: z.string().trim().max(120).optional(),
  mojRegistry: z.string().trim().max(120).optional(),
  mojNumber: z.string().trim().regex(/^\d{1,8}$/).optional(),
  mojYear: z.number().int().min(1950).max(2100).optional(),
  clientId: z.string().min(1),
  assignedLawyerId: z.string().min(1),
  traineeLawyerId: z.string().optional(),
  opposingParties: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  fees: z.number().nonnegative().optional(),
  acknowledgeConflict: z.boolean().optional(),
});

const updateSchema = z.object({
  status: z.nativeEnum(CaseStatus).optional(),
  privateNotes: z.string().max(5000).optional(),
  title: z.string().trim().min(2).max(200).optional(),
  summary: z.string().trim().max(3000).optional(),
  mojCourt: z.string().trim().max(120).optional(),
  mojJurisdiction: z.string().trim().max(120).optional(),
  mojRegistry: z.string().trim().max(120).optional(),
  mojNumber: z.string().trim().regex(/^\d{1,8}$/).optional(),
  mojYear: z.number().int().min(1950).max(2100).optional(),
  courtCity: z.string().trim().max(80).optional(),
  fees: z.number().nonnegative().optional(),
  traineeLawyerId: z.string().nullable().optional(),
  opposingParties: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
}).refine((value) => Object.keys(value).length > 0);

const redact = <T extends { privateNotes: string | null; fees: unknown; client: { nationalId?: string | null } }>(legalCase: T, user: SafeUser) => ({
  ...legalCase,
  privateNotes: user.canViewPrivateNotes ? unseal(legalCase.privateNotes) : null,
  fees: user.role === Role.SENIOR_LAWYER ? legalCase.fees : null,
  client: { ...legalCase.client, nationalId: user.canViewNationalId ? maskId(unseal(legalCase.client.nationalId)) : null },
});

export const GET = route(staffRoles, async (user, request) => {
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const data = await withDatabaseAccess(user, async (tx) => {
      const legalCase = await tx.legalCase.findFirst({
        where: { id, deletedAt: null },
        include: {
          client: { select: { id: true, name: true, phone: true, nationalId: true, whatsappOptOutAt: true } },
          assignedLawyer: { select: { id: true, name: true } },
          traineeLawyer: { select: { id: true, name: true } },
          hearings: { where: { deletedAt: null }, orderBy: { startsAt: "desc" } },
          judgments: { where: { deletedAt: null }, orderBy: { decidedAt: "desc" } },
          tasks: { where: { deletedAt: null }, orderBy: { dueAt: "asc" }, include: { assignee: { select: { id: true, name: true } } } },
          drafts: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, kind: true, status: true, generatedByAi: true, createdAt: true } },
          documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, fileName: true, pageCount: true, extraction: true, category: true, version: true, rootId: true, createdAt: true } },
          messages: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, body: true, status: true, direction: true, createdAt: true, sentAt: true } },
          updates: { orderBy: { occurredAt: "desc" }, include: { createdBy: { select: { name: true } } } },
          invoices: { where: { deletedAt: null }, orderBy: { issuedAt: "desc" }, include: { payments: true } },
        },
      });
      if (!legalCase) return null;
      const timeline = await tx.auditLog.findMany({
        where: { caseId: id },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: { id: true, action: true, createdAt: true, user: { select: { name: true } } },
      });
      return { legalCase, timeline };
    });
    if (!data) throw new HttpError("القضية غير موجودة أو غير متاحة لك.", 404);
    return { case: redact(data.legalCase, user), timeline: data.timeline };
  }
  const cases = await withDatabaseAccess(user, (tx) =>
    tx.legalCase.findMany({
      where: { deletedAt: null },
      include: {
        client: { select: { id: true, name: true, phone: true, nationalId: true } },
        assignedLawyer: { select: { id: true, name: true } },
        traineeLawyer: { select: { id: true, name: true } },
        hearings: { where: { deletedAt: null, startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 1 },
        _count: { select: { hearings: true, messages: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  );
  return { cases: cases.map((legalCase) => redact(legalCase, user)) };
});

export const POST = route([Role.SENIOR_LAWYER], async (user, request) => {
  const { acknowledgeConflict, ...input } = await parseBody(request, createSchema, "راجع بيانات القضية المدخلة.");
  const result = await withDatabaseAccess(user, async (tx) => {
    const duplicate = await tx.legalCase.findFirst({ where: { caseNumber: input.caseNumber }, select: { id: true } });
    if (duplicate) throw new HttpError("رقم الدعوى مسجل مسبقاً.", 409);
    const client = await tx.client.findFirst({ where: { id: input.clientId, deletedAt: null }, select: { id: true, name: true } });
    const assigned = await tx.user.findFirst({
      where: { id: input.assignedLawyerId, active: true, role: { in: [Role.SENIOR_LAWYER, Role.TRAINEE_LAWYER] } },
      select: { id: true },
    });
    const trainee = input.traineeLawyerId
      ? await tx.user.findFirst({ where: { id: input.traineeLawyerId, active: true, role: Role.TRAINEE_LAWYER }, select: { id: true } })
      : true;
    if (!client || !assigned || !trainee) return null;
    const conflicts = await conflictsFor(tx, [
      { name: client.name, role: "client" },
      ...input.opposingParties.map((name) => ({ name, role: "opposing" as const })),
    ], client.id);
    if (conflicts.length && !acknowledgeConflict) return { conflicts };
    const legalCase = await tx.legalCase.create({ data: { ...input, traineeLawyerId: input.traineeLawyerId || null } });
    return { legalCase, conflicts };
  });
  if (!result) throw new HttpError("العميل أو المحامي المحدد غير موجود.");
  if (!result.legalCase) return NextResponse.json({ error: "تحذير تعارض مصالح: راجع التطابقات قبل المتابعة.", conflicts: result.conflicts }, { status: 409 });
  const { legalCase, conflicts } = result;
  await logAudit(user, "CASE_CREATED", "LegalCase", legalCase.id, { caseNumber: legalCase.caseNumber, conflictsAcknowledged: conflicts.length }, legalCase.id);
  return NextResponse.json({ case: legalCase }, { status: 201 });
});

export const PATCH = route([Role.SENIOR_LAWYER], async (user, request) => {
  const id = requireId(request);
  const { privateNotes, ...data } = await parseBody(request, updateSchema, "معرّف القضية أو البيانات غير صالحة.");
  const legalCase = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.legalCase.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    return existing ? tx.legalCase.update({ where: { id }, data: { ...data, ...(privateNotes !== undefined ? { privateNotes: seal(privateNotes) } : {}) } }) : null;
  });
  if (!legalCase) throw new HttpError("القضية غير موجودة.", 404);
  await logAudit(user, "CASE_UPDATED", "LegalCase", id, { fields: Object.keys(data) }, id);
  return { case: { id: legalCase.id, status: legalCase.status } };
});

export const DELETE = route([Role.SENIOR_LAWYER], async (user, request) => {
  const id = requireId(request);
  await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.legalCase.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new HttpError("القضية غير موجودة.", 404);
    await tx.legalCase.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  await logAudit(user, "CASE_DELETED", "LegalCase", id, undefined, id);
  return { ok: true };
});
