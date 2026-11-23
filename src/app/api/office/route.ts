import { CaseType, CourtLevel, DeadlineBase, ReminderKind, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { isAssistantConfigured } from "@/lib/assistant/client";
import { ANTHROPIC, detectProvider, providerLabel } from "@/lib/assistant/providers";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { seal } from "@/lib/crypto";
import { isWhatsappConfigured } from "@/lib/whatsapp";

const senior = [Role.SENIOR_LAWYER];

const settingsSchema = z.object({
  aiEnabled: z.boolean().optional(),
  quietStart: z.number().int().min(0).max(23).optional(),
  quietEnd: z.number().int().min(1).max(24).optional(),
  staleDays: z.number().int().min(1).max(365).optional(),
}).refine((value) => value.quietStart === undefined || value.quietEnd === undefined || value.quietStart < value.quietEnd);

const ruleSchema = z.object({
  name: z.string().trim().min(2).max(160),
  caseType: z.nativeEnum(CaseType).optional(),
  court: z.nativeEnum(CourtLevel).optional(),
  days: z.number().int().min(1).max(3650),
  base: z.nativeEnum(DeadlineBase),
  legalBasis: z.string().trim().min(2).max(300),
  rollForward: z.boolean().default(false),
  pauseInVacation: z.boolean().default(false),
});

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const holidaySchema = z.object({ name: z.string().trim().min(2).max(120), startsOn: dayKey, endsOn: dayKey, kind: z.enum(["HOLIDAY", "JUDICIAL_VACATION"]) })
  .refine((value) => value.startsOn <= value.endsOn);

// The public site links to this address, so only real Google Maps links are accepted.
function isGoogleMapsUrl(value: string) {
  try {
    const { protocol, hostname, pathname } = new URL(value);
    if (protocol !== "https:") return false;
    if (["maps.app.goo.gl", "maps.google.com"].includes(hostname)) return true;
    if (hostname === "goo.gl") return pathname.startsWith("/maps");
    return /^(www\.)?google\.[a-z.]{2,8}$/.test(hostname) && pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

const contactSchema = z.object({
  officeWhatsapp: z.union([z.string().trim().regex(/^\+?[0-9][0-9 ()-]{6,19}$/), z.literal("")]),
  officeAddress: z.string().trim().max(300),
  officeMapUrl: z.union([z.string().trim().max(2000).refine(isGoogleMapsUrl), z.literal("")]),
});

// Write-only: nothing in this file ever sends the key back, not even a part of it.
const keySchema = z.object({ aiApiKey: z.string().trim().regex(/^\S{20,400}$/).nullable() });

const templateSchema = z.object({
  kind: z.nativeEnum(ReminderKind),
  body: z.string().trim().min(5).max(1000).optional(),
  metaName: z.string().trim().max(120).optional(),
  autoSend: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const GET = route(staffRoles, async (user) => {
  const data = await withDatabaseAccess(user, async (tx) => ({
    settings: await tx.officeSetting.findUniqueOrThrow({ where: { id: 1 }, omit: { aiApiKey: true, officePhoto: true } }),
    rules: await tx.deadlineRule.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } }),
    templates: await tx.messageTemplate.findMany({ orderBy: { kind: "asc" } }),
    holidays: await tx.holiday.findMany({ orderBy: { startsOn: "asc" } }),
  }));
  return { ...data, integrations: { claudeKey: await isAssistantConfigured(), aiProvider: providerLabel(data.settings.aiProvider ?? ANTHROPIC), whatsapp: isWhatsappConfigured() } };
});

export const PATCH = route(senior, async (user, request) => {
  const target = request.nextUrl.searchParams.get("target");
  if (target === "template") {
    const { kind, ...data } = await parseBody(request, templateSchema, "راجع نص القالب.");
    await withDatabaseAccess(user, (tx) => tx.messageTemplate.update({ where: { kind }, data: { ...data, ...(data.autoSend !== undefined ? { autoSendBy: data.autoSend ? user.id : null } : {}) } }));
    await logAudit(user, "TEMPLATE_UPDATED", "MessageTemplate", kind, data);
    return { ok: true };
  }
  if (target === "contact") {
    const { officeWhatsapp, officeAddress, officeMapUrl } = await parseBody(request, contactSchema, "راجع رقم الواتساب ورابط Google Maps.");
    await withDatabaseAccess(user, (tx) => tx.officeSetting.update({ where: { id: 1 }, data: { officeWhatsapp: officeWhatsapp || null, officeAddress: officeAddress || null, officeMapUrl: officeMapUrl || null } }));
    await logAudit(user, "SETTINGS_UPDATED", "OfficeSetting", "1", { fields: ["contact"] });
    return { ok: true };
  }
  if (target === "ai-key") {
    const { aiApiKey } = await parseBody(request, keySchema, "المفتاح غير صالح.");
    const detected = aiApiKey ? await detectProvider(aiApiKey) : null;
    if (aiApiKey && !detected) throw new HttpError("تعذر التحقق من المفتاح. تأكد أنه صحيح ومفعّل لدى المزود.");
    const provider = detected?.provider ?? null;
    await withDatabaseAccess(user, async (tx) => {
      const { aiProvider } = await tx.officeSetting.findUniqueOrThrow({ where: { id: 1 }, select: { aiProvider: true } });
      // Consent names a recipient, so a new provider needs a new approval.
      const reconsent = (aiProvider ?? ANTHROPIC) !== (provider ?? ANTHROPIC);
      await tx.officeSetting.update({
        where: { id: 1 },
        data: { aiApiKey: seal(aiApiKey), aiProvider: provider, aiModel: detected?.model ?? null, ...(reconsent ? { aiEnabled: false, aiEnabledBy: null, aiEnabledAt: null } : {}) },
      });
    });
    await logAudit(user, "SETTINGS_UPDATED", "OfficeSetting", "1", { fields: ["aiKey"], provider });
    return { ok: true };
  }
  const data = await parseBody(request, settingsSchema, "راجع القيم: بداية ساعات الإرسال قبل نهايتها.");
  await withDatabaseAccess(user, (tx) => tx.officeSetting.update({
    where: { id: 1 },
    data: { ...data, ...(data.aiEnabled !== undefined ? { aiEnabledBy: data.aiEnabled ? user.id : null, aiEnabledAt: data.aiEnabled ? new Date() : null } : {}) },
  }));
  await logAudit(user, "SETTINGS_UPDATED", "OfficeSetting", "1", data);
  return { ok: true };
});

export const POST = route(senior, async (user, request) => {
  if (request.nextUrl.searchParams.get("target") === "holiday") {
    const data = await parseBody(request, holidaySchema, "راجع اسم العطلة وتاريخيها: البداية قبل النهاية.");
    const holiday = await withDatabaseAccess(user, (tx) => tx.holiday.create({ data }));
    await logAudit(user, "HOLIDAY_ADDED", "Holiday", holiday.id, data);
    return NextResponse.json({ holiday }, { status: 201 });
  }
  const data = await parseBody(request, ruleSchema, "اسم القاعدة وعدد الأيام والسند القانوني مطلوبة.");
  const rule = await withDatabaseAccess(user, (tx) => tx.deadlineRule.create({ data }));
  await logAudit(user, "DEADLINE_RULE_CREATED", "DeadlineRule", rule.id, data);
  return NextResponse.json({ rule }, { status: 201 });
});

export const DELETE = route(senior, async (user, request) => {
  const holidayId = request.nextUrl.searchParams.get("holiday");
  if (holidayId) {
    await withDatabaseAccess(user, async (tx) => {
      if (!(await tx.holiday.deleteMany({ where: { id: holidayId } })).count) throw new HttpError("العطلة غير موجودة.", 404);
    });
    await logAudit(user, "HOLIDAY_DELETED", "Holiday", holidayId);
    return { ok: true };
  }
  const id = requireId(request);
  await withDatabaseAccess(user, async (tx) => {
    const rule = await tx.deadlineRule.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!rule) throw new HttpError("القاعدة غير موجودة.", 404);
    await tx.deadlineRule.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  await logAudit(user, "DEADLINE_RULE_DELETED", "DeadlineRule", id);
  return { ok: true };
});
