import { NextResponse } from "next/server";
import { DocumentCategory } from "@prisma/client";
import { z } from "zod";
import { HttpError, officeRoles, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { ALLOWED_DOCUMENT_TYPES, extractPages, MAX_DOCUMENT_BYTES } from "@/lib/documents";
import { aiAllowed } from "@/lib/settings";

const titleSchema = z.string().trim().min(2).max(200);
const updateSchema = z.object({ title: titleSchema.optional(), category: z.nativeEnum(DocumentCategory).optional() });
const NOT_SENT_TO_AI = "لم تُقرأ الصورة أو الملف الممسوح لأن القراءة بالذكاء الاصطناعي غير مفعّلة.";

export const GET = route(staffRoles, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const id = params.get("id");
  if (id) {
    const document = await withDatabaseAccess(user, (tx) =>
      tx.document.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true, title: true, fileName: true, mimeType: true, pageCount: true, extraction: true, category: true, version: true, rootId: true,
          legalCase: { select: { id: true, caseNumber: true } },
          pages: { orderBy: { page: "asc" }, select: { page: true, text: true } },
        },
      }),
    );
    if (!document) throw new HttpError("المستند غير موجود أو غير متاح لك.", 404);
    await logAudit(user, "DOCUMENT_VIEWED", "Document", id, undefined, document.legalCase.id);
    return { document };
  }
  const caseId = params.get("caseId") ?? undefined;
  const documents = await withDatabaseAccess(user, (tx) =>
    tx.document.findMany({
      where: { deletedAt: null, caseId, legalCase: { deletedAt: null } },
      select: {
        id: true, title: true, fileName: true, mimeType: true, size: true, pageCount: true, extraction: true, category: true, version: true, rootId: true, createdAt: true,
        legalCase: { select: { id: true, caseNumber: true, title: true } },
        uploadedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  );
  return { documents };
});

export const POST = route(staffRoles, async (user, request) => {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const caseId = form?.get("caseId");
  const versionOf = form?.get("versionOf");
  if (!(file instanceof File) || typeof caseId !== "string" || !caseId) throw new HttpError("اختر القضية والملف.");
  if (!ALLOWED_DOCUMENT_TYPES[file.type]) throw new HttpError("الأنواع المسموحة: PDF أو Word أو صورة أو نص.");
  if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) throw new HttpError("حجم الملف يجب ألا يتجاوز 15 ميغابايت.");
  const title = titleSchema.safeParse(form?.get("title") || file.name.replace(/\.[^.]+$/, ""));
  if (!title.success) throw new HttpError("عنوان المستند غير صالح.");
  const category = z.nativeEnum(DocumentCategory).catch("OTHER").parse(form?.get("category"));

  const content = Buffer.from(await file.arrayBuffer());
  const allowAi = await aiAllowed(user);
  // Extraction can call Claude, so it runs before the transaction opens.
  const pages = await extractPages(content, file.type, allowAi).catch((error: unknown) => {
    console.error(error);
    return [];
  });
  const document = await withDatabaseAccess(user, async (tx) => {
    const legalCase = await tx.legalCase.findFirst({ where: { id: caseId, deletedAt: null }, select: { id: true } });
    if (!legalCase) throw new HttpError("القضية غير موجودة أو غير متاحة لك.", 404);
    let rootId: string | null = null;
    let version = 1;
    let inherited: { title: string; category: DocumentCategory } | null = null;
    if (typeof versionOf === "string" && versionOf) {
      const previous = await tx.document.findFirst({ where: { id: versionOf, caseId, deletedAt: null } });
      if (!previous) throw new HttpError("المستند الأصلي غير موجود.", 404);
      rootId = previous.rootId ?? previous.id;
      const latest = await tx.document.aggregate({ where: { OR: [{ id: rootId }, { rootId }] }, _max: { version: true } });
      version = (latest._max.version ?? 1) + 1;
      inherited = { title: previous.title, category: previous.category };
    }
    const created = await tx.document.create({
      data: {
        caseId,
        title: inherited?.title ?? title.data,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        content,
        category: inherited?.category ?? category,
        version,
        rootId,
        pageCount: pages.length,
        extraction: pages.some((page) => page.text) ? "READY" : "NO_TEXT",
        uploadedById: user.id,
      },
      select: { id: true, title: true, pageCount: true, extraction: true, version: true },
    });
    if (pages.length) await tx.documentPage.createMany({ data: pages.map((page) => ({ ...page, documentId: created.id })) });
    return created;
  });
  await logAudit(user, "DOCUMENT_UPLOADED", "Document", document.id, { pages: document.pageCount, version: document.version }, caseId);
  return NextResponse.json({ document, note: document.extraction === "NO_TEXT" && !allowAi ? NOT_SENT_TO_AI : undefined }, { status: 201 });
});

export const PATCH = route(officeRoles, async (user, request) => {
  const id = requireId(request);
  const data = await parseBody(request, updateSchema, "راجع بيانات المستند.");
  const document = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.document.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new HttpError("المستند غير موجود.", 404);
    return tx.document.update({ where: { id }, data, select: { caseId: true } });
  });
  await logAudit(user, "DOCUMENT_UPDATED", "Document", id, { fields: Object.keys(data) }, document.caseId);
  return { ok: true };
});

export const DELETE = route(officeRoles, async (user, request) => {
  const id = requireId(request);
  const document = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.document.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new HttpError("المستند غير موجود.", 404);
    return tx.document.update({ where: { id }, data: { deletedAt: new Date() }, select: { caseId: true } });
  });
  await logAudit(user, "DOCUMENT_DELETED", "Document", id, undefined, document.caseId);
  return { ok: true };
});
