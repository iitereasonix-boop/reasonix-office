import type { Prisma, ReminderKind } from "@prisma/client";
import { logAudit, systemUser, withDatabaseAccess, type SafeUser } from "@/lib/auth";
import { addDays, ammanDayKey, ammanDayStart, ammanHour, displayDate, displayDateTime, insideQuietWindow, nextSendTime } from "@/lib/dates";
import { officeSettings } from "@/lib/settings";
import { fillTemplate, isWhatsappConfigured, sendWhatsapp } from "@/lib/whatsapp";

const APPEAL_NOTICE_DAYS = 7;

type Due = { kind: ReminderKind; entityId: string; clientId: string; caseId: string; client: string; caseNumber: string; date: string };

async function dueReminders(tx: Prisma.TransactionClient, now: Date) {
  const today = ammanDayStart(now);
  const liveCase = { legalCase: { deletedAt: null } };
  const pick = { legalCase: { select: { id: true, caseNumber: true, clientId: true, client: { select: { name: true } } } } };
  const inTwoDays = addDays(today, 2);
  const [twoDays, morning, judgments, appeals] = [
    await tx.hearing.findMany({ where: { deletedAt: null, ...liveCase, startsAt: { gte: inTwoDays, lt: addDays(inTwoDays, 1) } }, include: pick }),
    await tx.hearing.findMany({ where: { deletedAt: null, ...liveCase, startsAt: { gte: today, lt: addDays(today, 1) } }, include: pick }),
    await tx.judgment.findMany({ where: { deletedAt: null, ...liveCase, createdAt: { gte: addDays(today, -1) } }, include: pick }),
    await tx.judgment.findMany({ where: { deletedAt: null, ...liveCase, appealFiledAt: null, appealDeadline: { gte: today, lt: addDays(today, APPEAL_NOTICE_DAYS + 1) } }, include: pick }),
  ];
  const row = (kind: ReminderKind, entityId: string, legalCase: (typeof twoDays)[number]["legalCase"], date: string): Due => ({
    kind, entityId, clientId: legalCase.clientId, caseId: legalCase.id, client: legalCase.client.name, caseNumber: legalCase.caseNumber, date,
  });
  return [
    ...twoDays.map((item) => row("HEARING_TWO_DAYS", item.id, item.legalCase, displayDateTime(item.startsAt))),
    ...morning.map((item) => row("HEARING_MORNING", item.id, item.legalCase, displayDateTime(item.startsAt))),
    ...judgments.map((item) => row("JUDGMENT_ISSUED", item.id, item.legalCase, displayDate(item.decidedAt))),
    ...appeals.map((item) => row("APPEAL_DEADLINE", item.id, item.legalCase, displayDate(item.appealDeadline as Date))),
  ];
}

/** Sends one message that has already passed approval. Quiet hours and STOP are enforced here. */
export async function deliverMessage(user: SafeUser, id: string, now = new Date()) {
  // Approval already happened, so recording the outcome is the system's job. Staff keep no
  // database right to touch an approved message, and that rule stays intact.
  const system = (await systemUser()) ?? user;
  const { message, settings, template } = await withDatabaseAccess(user, async (tx) => {
    const message = await tx.message.findFirst({ where: { id, deletedAt: null, status: "APPROVED" }, include: { client: true } });
    return {
      message,
      settings: await officeSettings(tx),
      template: message?.reminderKind ? await tx.messageTemplate.findUnique({ where: { kind: message.reminderKind } }) : null,
    };
  });
  if (!message?.client) return { outcome: "skipped" as const, detail: "الرسالة ليست معتمدة." };
  if (message.client.whatsappOptOutAt) {
    await withDatabaseAccess(system, (tx) => tx.message.update({ where: { id }, data: { status: "CANCELLED", failure: "العميل ألغى الاشتراك (STOP)." } }));
    return { outcome: "blocked" as const, detail: "العميل ألغى الاشتراك." };
  }
  if (!insideQuietWindow(ammanHour(now), settings.quietStart, settings.quietEnd)) {
    const scheduledFor = nextSendTime(now, settings.quietStart, settings.quietEnd);
    await withDatabaseAccess(system, (tx) => tx.message.update({ where: { id }, data: { scheduledFor } }));
    return { outcome: "scheduled" as const, detail: `خارج ساعات الإرسال، جُدولت إلى ${displayDateTime(scheduledFor)}.` };
  }
  try {
    const waMessageId = await sendWhatsapp(message.client.phone, { body: message.body, params: message.templateParams, template });
    await withDatabaseAccess(system, (tx) => tx.message.update({
      where: { id }, data: { status: "SENT", sentAt: now, waMessageId, deliveryStatus: "sent", failure: null, scheduledFor: null },
    }));
    await logAudit(user, "MESSAGE_SENT_API", "Message", id, undefined, message.caseId ?? undefined);
    return { outcome: "sent" as const, detail: "أُرسلت عبر واتساب." };
  } catch (error) {
    const failure = error instanceof Error ? error.message : "تعذر الإرسال.";
    await withDatabaseAccess(system, (tx) => tx.message.update({ where: { id }, data: { failure } }));
    return { outcome: "failed" as const, detail: failure };
  }
}

/**
 * Creates each due reminder once, keyed by kind, record and day. A reminder is a draft for
 * approval unless the lawyer has turned on automatic sending for that exact template.
 */
export async function runReminders(now = new Date()) {
  const user = await systemUser();
  if (!user) return { created: 0, sent: 0, skipped: 0 };
  const created = await withDatabaseAccess(user, async (tx) => {
    const templates = await tx.messageTemplate.findMany({ where: { active: true } });
    const made: { id: string; auto: boolean }[] = [];
    for (const due of await dueReminders(tx, now)) {
      const template = templates.find((item) => item.kind === due.kind);
      if (!template) continue;
      const dedupeKey = due.kind === "APPEAL_DEADLINE" || due.kind === "JUDGMENT_ISSUED" ? `${due.kind}:${due.entityId}` : `${due.kind}:${due.entityId}:${ammanDayKey(now)}`;
      if (await tx.message.findUnique({ where: { dedupeKey }, select: { id: true } })) continue;
      const params = [due.client, due.caseNumber, due.date];
      const message = await tx.message.create({
        data: { clientId: due.clientId, caseId: due.caseId, body: fillTemplate(template.body, params), reminderKind: due.kind, templateParams: params, dedupeKey },
      });
      if (template.autoSend) await tx.message.update({ where: { id: message.id }, data: { status: "APPROVED", approvedAt: now } });
      made.push({ id: message.id, auto: template.autoSend });
    }
    return made;
  });

  let sent = 0;
  if (isWhatsappConfigured()) {
    const waiting = await withDatabaseAccess(user, (tx) => tx.message.findMany({
      where: { deletedAt: null, status: "APPROVED", direction: "OUTBOUND", OR: [{ scheduledFor: { lte: now } }, { id: { in: created.filter((item) => item.auto).map((item) => item.id) } }] },
      select: { id: true },
    }));
    for (const { id } of waiting) if ((await deliverMessage(user, id, now)).outcome === "sent") sent += 1;
  }
  return { created: created.length, sent, skipped: 0 };
}
