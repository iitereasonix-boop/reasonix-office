import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { ALLOWED_DOCUMENT_TYPES, extractPages, MAX_DOCUMENT_BYTES } from "@/lib/documents";
import { splitArticles } from "@/lib/legal";
import { aiAllowed } from "@/lib/settings";

const meta = z.object({
  title: z.string().trim().min(2).max(200),
  reference: z.string().trim().min(2).max(300),
});
const schema = meta.extend({ text: z.string().trim().min(10).max(2_000_000) });
const listSelect = {
  id: true,
  title: true,
  reference: true,
  fileName: true,
  mimeType: true,
  size: true,
  officialType: true,
  officialStatus: true,
  officialUrl: true,
  lastVerifiedAt: true,
  createdAt: true,
  _count: { select: { articles: true } },
} as const;

export const GET = route(staffRoles, async (user, request) => {
  const params = request.nextUrl.searchParams;
  const fileId = params.get("file");
  if (fileId) {
    const source = await withDatabaseAccess(user, (tx) =>
      tx.legalSource.findFirst({ where: { id: fileId, deletedAt: null }, select: { content: true, mimeType: true, fileName: true } }),
    );
    if (!source?.content || !source.mimeType || !source.fileName) throw new HttpError("لا يوجد ملف أصلي لهذا النص.", 404);
    return new Response(new Uint8Array(source.content), {
      headers: {
        "Content-Type": source.mimeType === "text/plain" ? "text/plain; charset=utf-8" : source.mimeType,
        "Content-Disposition": `${params.get("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(source.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }
  const id = params.get("id");
  return withDatabaseAccess(user, async (tx) => {
    if (id) {
      const source = await tx.legalSource.findFirst({
        where: { id, deletedAt: null },
        select: { ...listSelect, articles: { select: { id: true, number: true, text: true } } },
      });
      if (!source) throw new HttpError("المصدر غير موجود.", 404);
      return { source };
    }
    const sources = await tx.legalSource.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: listSelect });
    return { sources };
  });
});

/** Reads the law out of an uploaded file; scanned files need AI reading switched on. */
async function fromUpload(user: Parameters<typeof aiAllowed>[0], form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError("اختر الملف.");
  if (!ALLOWED_DOCUMENT_TYPES[file.type]) throw new HttpError("الأنواع المسموحة: PDF أو Word (docx) أو صورة أو نص. احفظ ملفات Word القديمة (doc) بصيغة docx.");
  if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) throw new HttpError("حجم الملف يجب ألا يتجاوز 15 ميغابايت.");
  const input = meta.safeParse({ title: form.get("title") || file.name.replace(/\.[^.]+$/, ""), reference: form.get("reference") });
  if (!input.success) throw new HttpError("اسم القانون والمرجع الرسمي مطلوبان.");
  const content = Buffer.from(await file.arrayBuffer());
  const pages = await extractPages(content, file.type, await aiAllowed(user)).catch((error: unknown) => {
    console.error(error);
    return [];
  });
  const text = pages.map((page) => page.text).join("\n").trim();
  return { data: input.data, text, file: { fileName: file.name, mimeType: file.type, size: file.size, content } };
}

export const POST = route([Role.SENIOR_LAWYER], async (user, request) => {
  const isUpload = request.headers.get("content-type")?.startsWith("multipart/form-data");
  const { data, text, file } = isUpload
    ? await fromUpload(user, (await request.formData().catch(() => null)) ?? new FormData())
    : { ...(await parseBody(request, schema, "العنوان والمرجع والنص مطلوبة.").then(({ text, ...rest }) => ({ data: rest, text }))), file: undefined };
  // A file with no readable text is still kept; it can be downloaded but not searched.
  const articles = text ? splitArticles(text) : [];
  const source = await withDatabaseAccess(user, async (tx) => {
    const created = await tx.legalSource.create({ data: { ...data, ...file, addedById: user.id }, select: { id: true, title: true } });
    if (articles.length) await tx.legalArticle.createMany({ data: articles.map((article) => ({ ...article, sourceId: created.id })) });
    return created;
  });
  await logAudit(user, "LEGAL_SOURCE_ADDED", "LegalSource", source.id, { articles: articles.length, file: file?.fileName });
  return NextResponse.json({ source, articles: articles.length, unread: Boolean(file) && !articles.length }, { status: 201 });
});

export const DELETE = route([Role.SENIOR_LAWYER], async (user, request) => {
  const id = requireId(request);
  await withDatabaseAccess(user, async (tx) => {
    if (!(await tx.legalSource.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } })).count) throw new HttpError("المصدر غير موجود.", 404);
  });
  await logAudit(user, "LEGAL_SOURCE_DELETED", "LegalSource", id);
  return { ok: true };
});
