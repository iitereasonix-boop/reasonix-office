import { NextResponse } from "next/server";
import { CaseType, CourtLevel, Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, officeRoles, parseBody, rateLimit, requireId, route } from "@/lib/api";
import { logAgentRun } from "@/lib/agent-log";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { ALLOWED_DOCUMENT_TYPES, extractPages, MAX_DOCUMENT_BYTES } from "@/lib/documents";
import { extractFields, hearingDate, verifyExtraction } from "@/lib/intake";
import { matchClient } from "@/lib/matching";
import { aiAllowed } from "@/lib/settings";
import { normalizeArabic } from "@/lib/text";

const acceptSchema = z.object({
  action: z.literal("accept"),
  clientId: z.string().min(1),
  caseNumber: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(200),
  type: z.nativeEnum(CaseType),
  court: z.nativeEnum(CourtLevel),
  assignedLawyerId: z.string().min(1),
  hearingAt: z.string().datetime().optional(),
});
const rejectSchema = z.object({ action: z.literal("reject"), note: z.string().trim().max(500).optional() });
const courtWords: [string, CourtLevel][] = [["تمييز", "CASSATION"], ["استئناف", "APPEAL"], ["صلح", "MAGISTRATES"], ["بدايه", "FIRST_INSTANCE"]];

export const GET = route(officeRoles, async (user) => {
  const items = await withDatabaseAccess(user, (tx) =>
    tx.intakeItem.findMany({
      where: { status: { in: ["SUGGESTED", "NEEDS_REVIEW"] } },
      select: { id: true, fileName: true, status: true, extracted: true, matchedClientId: true, matchScore: true, reviewNote: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  );
  return { items: items.map((item) => ({ ...item, courtLevel: courtWords.find(([word]) => normalizeArabic((item.extracted as { court?: { value?: string } } | null)?.court?.value ?? "").includes(word))?.[1] ?? null })) };
});

/** Reads each file and proposes a row. Nothing becomes a case until a person accepts it. */
export const POST = route(officeRoles, async (user, request) => {
  if (!rateLimit(`intake:${user.id}`, 40, 3_600_000)) throw new HttpError("عدد كبير من الملفات خلال ساعة.", 429);
  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((file): file is File => file instanceof File);
  if (!files.length || files.length > 20) throw new HttpError("اختر من ملف إلى 20 ملفاً.");
  const allowAi = await aiAllowed(user);
  const results = [];
  for (const file of files) {
    if (!ALLOWED_DOCUMENT_TYPES[file.type] || file.size === 0 || file.size > MAX_DOCUMENT_BYTES) throw new HttpError(`الملف «${file.name}» غير مسموح أو كبير الحجم.`);
    const content = Buffer.from(await file.arrayBuffer());
    const pages = await extractPages(content, file.type, allowAi).catch(() => []);
    const text = pages.map((page) => page.text).join("\n");
    let extraction: ReturnType<typeof verifyExtraction> = null;
    let note = allowAi ? "" : "القراءة بالذكاء الاصطناعي غير مفعّلة، أدخل البيانات يدوياً.";
    if (allowAi && text) {
      try {
        const raw = await extractFields(text);
        extraction = verifyExtraction(raw, text);
        if (!extraction) note = "رُفضت نتيجة الوكيل لأنها لا تطابق المخطط.";
        await logAgentRun(user, { agent: "intake", input: { file: file.name, characters: text.length }, output: raw, status: extraction ? "ok" : "schema_rejected" });
      } catch (error) {
        console.error(error);
        note = "تعذرت قراءة الملف بالوكيل.";
        await logAgentRun(user, { agent: "intake", input: { file: file.name }, status: "error" });
      }
    }
    const item = await withDatabaseAccess(user, async (tx) => {
      const clients = await tx.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
      const match = matchClient(extraction?.client_name.value, clients);
      const complete = extraction?.case_number.value && match.confident;
      return tx.intakeItem.create({
        data: {
          fileName: file.name, mimeType: file.type, size: file.size, content, text,
          extracted: extraction ?? undefined,
          matchedClientId: match.client?.id,
          matchScore: match.score,
          status: complete ? "SUGGESTED" : "NEEDS_REVIEW",
          reviewNote: note || match.reason,
          createdById: user.id,
        },
        select: { id: true, status: true },
      });
    });
    results.push(item);
  }
  await logAudit(user, "INTAKE_UPLOADED", "IntakeItem", results[0].id, { files: files.length });
  return NextResponse.json({ items: results }, { status: 201 });
});

export const PATCH = route(officeRoles, async (user, request) => {
  const id = requireId(request);
  const input = await parseBody(request, z.discriminatedUnion("action", [acceptSchema, rejectSchema]), "راجع بيانات القضية قبل الحفظ.");
  if (input.action === "reject") {
    await withDatabaseAccess(user, (tx) => tx.intakeItem.update({ where: { id }, data: { status: "REJECTED", reviewedById: user.id, reviewedAt: new Date(), reviewNote: input.note } }));
    await logAudit(user, "INTAKE_REJECTED", "IntakeItem", id);
    return { ok: true };
  }
  if (user.role !== Role.SENIOR_LAWYER) throw new HttpError("فتح القضية للمحامي صاحب المكتب فقط.", 403);
  const caseId = await withDatabaseAccess(user, async (tx) => {
    const item = await tx.intakeItem.findFirst({ where: { id, status: { in: ["SUGGESTED", "NEEDS_REVIEW"] } } });
    if (!item) throw new HttpError("الملف غير موجود أو رُوجع سابقاً.", 404);
    if (await tx.legalCase.findFirst({ where: { caseNumber: input.caseNumber }, select: { id: true } })) throw new HttpError("رقم الدعوى مسجل مسبقاً.", 409);
    const legalCase = await tx.legalCase.create({
      data: { caseNumber: input.caseNumber, title: input.title, type: input.type, court: input.court, clientId: input.clientId, assignedLawyerId: input.assignedLawyerId, opposingParties: [] },
    });
    const pages = await extractPages(Buffer.from(item.content), item.mimeType, false).catch(() => []);
    const shown = pages.length ? pages : item.text ? [{ page: 1, text: item.text, searchText: normalizeArabic(item.text) }] : [];
    const document = await tx.document.create({
      data: {
        caseId: legalCase.id, title: item.fileName.replace(/\.[^.]+$/, ""), fileName: item.fileName, mimeType: item.mimeType, size: item.size, content: item.content,
        pageCount: shown.length, extraction: shown.length ? "READY" : "NO_TEXT", uploadedById: user.id,
      },
    });
    if (shown.length) await tx.documentPage.createMany({ data: shown.map((page) => ({ ...page, documentId: document.id })) });
    const hearingAt = input.hearingAt ? new Date(input.hearingAt) : hearingDate((item.extracted as { hearing_date?: { value?: string | null } } | null)?.hearing_date?.value ?? null);
    if (hearingAt) await tx.hearing.create({ data: { caseId: legalCase.id, startsAt: hearingAt, purpose: "من ملف التوزيع" } });
    await tx.intakeItem.update({ where: { id }, data: { status: "ACCEPTED", caseId: legalCase.id, reviewedById: user.id, reviewedAt: new Date() } });
    return legalCase.id;
  });
  await logAudit(user, "INTAKE_ACCEPTED", "LegalCase", caseId, { intakeId: id }, caseId);
  return { caseId };
});
