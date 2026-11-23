import { NextResponse } from "next/server";
import { DraftKind, Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { displayDate } from "@/lib/dates";

const senior = [Role.SENIOR_LAWYER];
const schema = z.object({ name: z.string().trim().min(2).max(120), kind: z.nativeEnum(DraftKind), body: z.string().trim().min(5).max(30000) });
const fillSchema = z.object({ templateId: z.string().min(1), caseId: z.string().min(1) });
const courtLabels: Record<string, string> = { FIRST_INSTANCE: "بداية", MAGISTRATES: "صلح", APPEAL: "استئناف", CASSATION: "تمييز" };

const fillPlaceholders = (body: string, values: Record<string, string>) =>
  body.replace(/\{\{(\w+)\}\}/g, (marker, key: string) => values[key] ?? marker);

export const GET = route(staffRoles, async (user) => ({
  templates: await withDatabaseAccess(user, (tx) => tx.documentTemplate.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } })),
}));

/** Filling always produces a draft, so a template never reaches anyone without review. */
export const POST = route(staffRoles, async (user, request) => {
  if (request.nextUrl.searchParams.get("fill")) {
    const { templateId, caseId } = await parseBody(request, fillSchema, "اختر القالب والقضية.");
    const draft = await withDatabaseAccess(user, async (tx) => {
      const template = await tx.documentTemplate.findFirst({ where: { id: templateId, deletedAt: null } });
      const legalCase = await tx.legalCase.findFirst({
        where: { id: caseId, deletedAt: null },
        include: { client: { select: { name: true } }, assignedLawyer: { select: { name: true } } },
      });
      if (!template || !legalCase) throw new HttpError("القالب أو القضية غير موجودة.", 404);
      return tx.legalDraft.create({
        data: {
          caseId,
          title: `${template.name} — ${legalCase.caseNumber}`,
          kind: template.kind,
          createdById: user.id,
          body: fillPlaceholders(template.body, {
            client_name: legalCase.client.name,
            lawyer_name: legalCase.assignedLawyer.name,
            case_number: legalCase.caseNumber,
            case_title: legalCase.title,
            court: `${courtLabels[legalCase.court]}${legalCase.courtCity ? ` ${legalCase.courtCity}` : ""}`,
            opposing_parties: legalCase.opposingParties.join("، ") || "____",
            today: displayDate(new Date()),
          }),
        },
      });
    });
    await logAudit(user, "DRAFT_FROM_TEMPLATE", "LegalDraft", draft.id, { templateId }, caseId);
    return NextResponse.json({ draft: { id: draft.id } }, { status: 201 });
  }
  if (user.role !== Role.SENIOR_LAWYER) throw new HttpError("إدارة القوالب للمحامي صاحب المكتب.", 403);
  const data = await parseBody(request, schema, "راجع اسم القالب ونصه.");
  const template = await withDatabaseAccess(user, (tx) => tx.documentTemplate.create({ data }));
  await logAudit(user, "TEMPLATE_CREATED", "DocumentTemplate", template.id);
  return NextResponse.json({ template }, { status: 201 });
});

export const PATCH = route(senior, async (user, request) => {
  const id = requireId(request);
  const data = await parseBody(request, schema, "راجع اسم القالب ونصه.");
  await withDatabaseAccess(user, (tx) => tx.documentTemplate.update({ where: { id }, data }));
  await logAudit(user, "TEMPLATE_UPDATED", "DocumentTemplate", id);
  return { ok: true };
});

export const DELETE = route(senior, async (user, request) => {
  const id = requireId(request);
  await withDatabaseAccess(user, (tx) => tx.documentTemplate.update({ where: { id }, data: { deletedAt: new Date() } }));
  await logAudit(user, "TEMPLATE_DELETED", "DocumentTemplate", id);
  return { ok: true };
});
