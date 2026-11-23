import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { HttpError, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { deliverMessage } from "@/lib/reminders";
import { isWhatsappConfigured } from "@/lib/whatsapp";

const createSchema = z.object({
  clientId: z.string().min(1),
  caseId: z.string().optional(),
  body: z.string().trim().min(1).max(2000),
});
const updateSchema = z.object({
  body: z.string().trim().min(1).max(2000).optional(),
  action: z.enum(["approve", "cancel", "markSent", "send"]).optional(),
});

export const GET = route(staffRoles, async (user) => {
  const messages = await withDatabaseAccess(user, (tx) =>
    tx.message.findMany({
      where: { deletedAt: null },
      include: { client: { select: { id: true, name: true, phone: true } }, legalCase: { select: { id: true, caseNumber: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );
  return { messages, apiConfigured: isWhatsappConfigured() };
});

export const POST = route(staffRoles, async (user, request) => {
  const input = await parseBody(request, createSchema, "راجع بيانات مسودة الرسالة.");
  const message = await withDatabaseAccess(user, async (tx) => {
    const client = await tx.client.findFirst({ where: { id: input.clientId, deletedAt: null }, select: { id: true } });
    if (!client) return null;
    if (input.caseId) {
      const legalCase = await tx.legalCase.findFirst({ where: { id: input.caseId, clientId: client.id, deletedAt: null }, select: { id: true } });
      if (!legalCase) return null;
    }
    return tx.message.create({ data: input });
  });
  if (!message) throw new HttpError("العميل أو القضية غير موجودة.");
  await logAudit(user, "MESSAGE_DRAFT_CREATED", "Message", message.id, { status: message.status }, message.caseId ?? undefined);
  return NextResponse.json({ message }, { status: 201 });
});

// "send" goes through the Cloud API after approval; markSent records a send done by hand.
export const PATCH = route(staffRoles, async (user, request) => {
  const id = requireId(request);
  const { body, action } = await parseBody(request, updateSchema, "راجع بيانات الرسالة.");
  if (action === "approve" && user.role !== Role.SENIOR_LAWYER) throw new HttpError("الاعتماد للمحامي صاحب المكتب فقط.", 403);
  if (action === "send") {
    if (user.role === Role.TRAINEE_LAWYER) throw new HttpError("لا يملك المتدرب إرسال الرسائل.", 403);
    if (!isWhatsappConfigured()) throw new HttpError("ربط واتساب غير مفعّل. استخدم «فتح في واتساب».", 409);
    const result = await deliverMessage(user, id);
    if (result.outcome === "failed" || result.outcome === "skipped") throw new HttpError(result.detail, 409);
    return { result };
  }
  const message = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.message.findFirst({ where: { id, deletedAt: null, direction: "OUTBOUND" } });
    if (!existing) throw new HttpError("الرسالة غير موجودة.", 404);
    if (body !== undefined && existing.status !== "DRAFT") throw new HttpError("لا يمكن تعديل رسالة بعد اعتمادها.", 409);
    if (action === "approve" && existing.status !== "DRAFT") throw new HttpError("الرسالة ليست مسودة.", 409);
    if (action === "markSent" && existing.status !== "APPROVED") throw new HttpError("يجب اعتماد الرسالة قبل إرسالها.", 409);
    if (action === "markSent" && user.role === Role.TRAINEE_LAWYER) throw new HttpError("لا يملك المتدرب إرسال الرسائل.", 403);
    if (action === "cancel" && existing.status === "SENT") throw new HttpError("لا يمكن إلغاء رسالة مرسلة.", 409);
    return tx.message.update({
      where: { id },
      data: {
        ...(body !== undefined ? { body } : {}),
        ...(action === "approve" ? { status: "APPROVED", approvedAt: new Date() } : {}),
        ...(action === "markSent" ? { status: "SENT", sentAt: new Date() } : {}),
        ...(action === "cancel" ? { status: "CANCELLED" } : {}),
      },
    });
  });
  await logAudit(user, action ? `MESSAGE_${action.toUpperCase()}` : "MESSAGE_EDITED", "Message", id, undefined, message.caseId ?? undefined);
  return { message };
});
