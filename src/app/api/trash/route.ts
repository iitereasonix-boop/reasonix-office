import { Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, parseBody, route } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";

const senior = [Role.SENIOR_LAWYER];
const deleted = { deletedAt: { not: null } };
const kinds = ["client", "case", "hearing", "judgment", "document", "task", "draft", "invoice"] as const;
const schema = z.object({ kind: z.enum(kinds), id: z.string().min(1) });

export const GET = route(senior, async (user) => {
  const rows = await withDatabaseAccess(user, async (tx) => {
    const [clients, cases, hearings, judgments, documents, tasks, drafts, invoices] = [
      await tx.client.findMany({ where: deleted, select: { id: true, name: true, deletedAt: true } }),
      await tx.legalCase.findMany({ where: deleted, select: { id: true, caseNumber: true, title: true, deletedAt: true } }),
      await tx.hearing.findMany({ where: deleted, select: { id: true, purpose: true, deletedAt: true, legalCase: { select: { caseNumber: true } } } }),
      await tx.judgment.findMany({ where: deleted, select: { id: true, title: true, deletedAt: true } }),
      await tx.document.findMany({ where: deleted, select: { id: true, title: true, deletedAt: true } }),
      await tx.task.findMany({ where: deleted, select: { id: true, title: true, deletedAt: true } }),
      await tx.legalDraft.findMany({ where: deleted, select: { id: true, title: true, deletedAt: true } }),
      await tx.invoice.findMany({ where: deleted, select: { id: true, number: true, deletedAt: true } }),
    ];
    return [
      ...clients.map((row) => ({ kind: "client", label: "عميل", title: row.name, id: row.id, deletedAt: row.deletedAt })),
      ...cases.map((row) => ({ kind: "case", label: "قضية", title: `${row.caseNumber} — ${row.title}`, id: row.id, deletedAt: row.deletedAt })),
      ...hearings.map((row) => ({ kind: "hearing", label: "جلسة", title: `${row.legalCase.caseNumber} ${row.purpose ?? ""}`, id: row.id, deletedAt: row.deletedAt })),
      ...judgments.map((row) => ({ kind: "judgment", label: "حكم", title: row.title, id: row.id, deletedAt: row.deletedAt })),
      ...documents.map((row) => ({ kind: "document", label: "مستند", title: row.title, id: row.id, deletedAt: row.deletedAt })),
      ...tasks.map((row) => ({ kind: "task", label: "مهمة", title: row.title, id: row.id, deletedAt: row.deletedAt })),
      ...drafts.map((row) => ({ kind: "draft", label: "مسودة", title: row.title, id: row.id, deletedAt: row.deletedAt })),
      ...invoices.map((row) => ({ kind: "invoice", label: "فاتورة", title: row.number, id: row.id, deletedAt: row.deletedAt })),
    ];
  });
  return { rows };
});

export const POST = route(senior, async (user, request) => {
  const { kind, id } = await parseBody(request, schema, "عنصر غير صالح.");
  const data = { deletedAt: null };
  await withDatabaseAccess(user, async (tx) => {
    const restore = {
      client: () => tx.client.updateMany({ where: { id }, data }),
      case: () => tx.legalCase.updateMany({ where: { id }, data }),
      hearing: () => tx.hearing.updateMany({ where: { id }, data }),
      judgment: () => tx.judgment.updateMany({ where: { id }, data }),
      document: () => tx.document.updateMany({ where: { id }, data }),
      task: () => tx.task.updateMany({ where: { id }, data }),
      draft: () => tx.legalDraft.updateMany({ where: { id }, data }),
      invoice: () => tx.invoice.updateMany({ where: { id }, data }),
    }[kind];
    if (!(await restore()).count) throw new HttpError("العنصر غير موجود.", 404);
  });
  await logAudit(user, "RECORD_RESTORED", kind, id);
  return { ok: true };
});
