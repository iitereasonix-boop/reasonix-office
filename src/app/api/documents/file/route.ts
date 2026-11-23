import { HttpError, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";

export const GET = route(staffRoles, async (user, request) => {
  const id = requireId(request);
  const document = await withDatabaseAccess(user, (tx) =>
    tx.document.findFirst({ where: { id, deletedAt: null }, select: { content: true, mimeType: true, fileName: true, caseId: true } }),
  );
  if (!document) throw new HttpError("المستند غير موجود أو غير متاح لك.", 404);
  await logAudit(user, "DOCUMENT_DOWNLOADED", "Document", id, undefined, document.caseId);
  return new Response(new Uint8Array(document.content), {
    headers: {
      "Content-Type": document.mimeType === "text/plain" ? "text/plain; charset=utf-8" : document.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
