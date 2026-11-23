import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessageTemplate } from "@prisma/client";
import { whatsappNumber } from "@/lib/text";

const base = () => process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0";

export const isWhatsappConfigured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

export const fillTemplate = (body: string, params: string[]) =>
  body.replace(/\{\{(\d+)\}\}/g, (marker, index: string) => params[Number(index) - 1] ?? marker);

export const digitsOnly = (phone: string) => phone.replace(/\D/g, "");

async function post(payload: object) {
  const response = await fetch(`${base()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `WhatsApp API ${response.status}`);
  return body?.messages?.[0]?.id as string | undefined;
}

/** Outside the 24-hour window Meta accepts approved templates only, so templates are preferred. */
export function sendWhatsapp(phone: string, message: { body: string; params?: string[]; template?: Pick<MessageTemplate, "metaName" | "language"> | null }) {
  const to = whatsappNumber(phone);
  if (message.template?.metaName) {
    return post({
      to,
      type: "template",
      template: {
        name: message.template.metaName,
        language: { code: message.template.language },
        components: [{ type: "body", parameters: (message.params ?? []).map((text) => ({ type: "text", text })) }],
      },
    });
  }
  return post({ to, type: "text", text: { body: message.body } });
}

export function validSignature(rawBody: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const STOP_WORDS = new Set(["stop", "unsubscribe", "الغاء", "إلغاء", "ايقاف", "إيقاف", "توقف"]);
const START_WORDS = new Set(["start", "اشتراك"]);
export const isStopRequest = (text: string) => STOP_WORDS.has(text.trim().toLowerCase());
export const isStartRequest = (text: string) => START_WORDS.has(text.trim().toLowerCase());
