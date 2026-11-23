import { NextResponse } from "next/server";
import { DraftKind, Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";

const createSchema = z.object({
  caseId: z.string().min(1),
  title: z.string().trim().min(2).max(200),
  kind: z.nativeEnum(DraftKind).default(DraftKind.MEMO),
  body: z.string().trim().min(2).max(30000),
});
const updateSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  body: z.string().trim().min(2).max(30000).optional(),
  action: z.enum(["approve", "reject", "reopen"]).optional(),
});

const include = {
  legalCase: { select: { id: true, caseNumber: true, title: true } },
  createdBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
} as const;

export const GET = route(staffRoles, async (user, request) => {
  const id = request.nextUrl.searchParams.get("id");
  return withDatabaseAccess(user, async (tx) => {
    if (id) {
      const draft = await tx.legalDraft.findFirst({ where: { id, deletedAt: null }, include });
      if (!draft) throw new HttpError("المسودة غير موجودة أو غير متاحة لك.", 404);
      return { draft };
    }
    return { drafts: await tx.legalDraft.findMany({ where: { deletedAt: null, legalCase: { deletedAt: null } }, include, orderBy: { createdAt: "desc" }, take: 200 }) };
  });
});

export const POST = route(staffRoles, async (user, request) => {
  const input = await parseBody(request, createSchema, "راجع بيانات المسودة.");
  const draft = await withDatabaseAccess(user, async (tx) => {
    const legalCase = await tx.legalCase.findFirst({ where: { id: input.caseId, deletedAt: null }, select: { id: true } });
    if (!legalCase) throw new HttpError("القضية غير موجودة أو غير متاحة لك.", 404);
    return tx.legalDraft.create({ data: { ...input, createdById: user.id } });
  });
  await logAudit(user, "DRAFT_CREATED", "LegalDraft", draft.id, undefined, draft.caseId);
  return NextResponse.json({ draft }, { status: 201 });
});

export const PATCH = route(staffRoles, async (user, request) => {
  const id = requireId(request);
  const { action, ...data } = await parseBody(request, updateSchema, "راجع بيانات المسودة.");
  const isSenior = user.role === Role.SENIOR_LAWYER;
  if (action && !isSenior) throw new HttpError("الاعتماد للمحامي صاحب المكتب فقط.", 403);
  const draft = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.legalDraft.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new HttpError("المسودة غير موجودة.", 404);
    if (!action && existing.status !== "DRAFT") throw new HttpError("أعد فتح المسودة قبل تعديلها.", 409);
    if (!isSenior && existing.createdById !== user.id) throw new HttpError("يعدّل المسودة كاتبها أو المحامي صاحب المكتب.", 403);
    const review = action === "reopen"
      ? { status: "DRAFT" as const, reviewedById: null, reviewedAt: null }
      : action
        ? { status: action === "approve" ? ("APPROVED" as const) : ("REJECTED" as const), reviewedById: user.id, reviewedAt: new Date() }
        : {};
    return tx.legalDraft.update({ where: { id }, data: { ...data, ...review } });
  });
  await logAudit(user, action ? `DRAFT_${action.toUpperCase()}` : "DRAFT_EDITED", "LegalDraft", id, undefined, draft.caseId);
  return { draft };
});

export const DELETE = route(staffRoles, async (user, request) => {
  const id = requireId(request);
  const draft = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.legalDraft.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new HttpError("المسودة غير موجودة.", 404);
    if (existing.status === "APPROVED") throw new HttpError("لا يمكن حذف مسودة معتمدة.", 409);
    return tx.legalDraft.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  await logAudit(user, "DRAFT_DELETED", "LegalDraft", id, undefined, draft.caseId);
  return { ok: true };
});
