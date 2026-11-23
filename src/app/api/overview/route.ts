import { Role } from "@prisma/client";
import { route, staffRoles } from "@/lib/api";
import { withDatabaseAccess } from "@/lib/auth";
import { addDays, ammanDayStart } from "@/lib/dates";
import { officeSettings } from "@/lib/settings";

const activityLabels: Record<string, string> = {
  CASE_CREATED: "تم فتح قضية جديدة",
  CASE_UPDATED: "تم تحديث بيانات قضية",
  CLIENT_CREATED: "تمت إضافة عميل جديد",
  HEARING_CREATED: "تمت إضافة جلسة جديدة",
  HEARING_UPDATED: "تم تحديث جلسة",
  DOCUMENT_UPLOADED: "تم رفع مستند جديد",
  JUDGMENT_CREATED: "تم تسجيل حكم",
  DRAFT_APPROVE: "تم اعتماد مسودة قانونية",
  AI_DRAFT_CREATED: "جهّز المساعد مسودة للمراجعة",
  MESSAGE_APPROVE: "تم اعتماد رسالة واتساب",
  MESSAGE_MARKSENT: "تم إرسال رسالة واتساب",
  TASK_CREATED: "تمت إضافة مهمة",
};

export const GET = route(staffRoles, async (user, request) => {
  const months = Math.min(Number(request.nextUrl.searchParams.get("months")) || 6, 24);
  return withDatabaseAccess(user, async (tx) => {
    const now = new Date();
    const dayStart = ammanDayStart(now);
    const dayEnd = addDays(dayStart, 1);
    const weekEnd = addDays(dayStart, 7);
    const appealEnd = addDays(dayStart, 14);
    const { staleDays } = await officeSettings(tx);
    const staleBefore = addDays(now, -staleDays);
    const since = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
    const liveCase = { legalCase: { deletedAt: null } };

    const [clients, cases, todayHearings, weekHearings, weekList, drafts, legalDrafts, appeals, upcomingAppeals, staleCases, byType, activity] = [
      await tx.client.count({ where: { deletedAt: null } }),
      await tx.legalCase.count({ where: { deletedAt: null } }),
      await tx.hearing.findMany({
        where: { deletedAt: null, ...liveCase, startsAt: { gte: dayStart, lt: dayEnd } },
        include: { legalCase: { select: { id: true, caseNumber: true, title: true, court: true, client: { select: { name: true } } } } },
        orderBy: { startsAt: "asc" },
      }),
      await tx.hearing.count({ where: { deletedAt: null, ...liveCase, startsAt: { gte: dayStart, lt: weekEnd } } }),
      await tx.hearing.findMany({
        where: { deletedAt: null, ...liveCase, startsAt: { gte: dayEnd, lt: weekEnd } },
        select: { id: true, startsAt: true, purpose: true, legalCase: { select: { id: true, caseNumber: true, client: { select: { name: true } } } } },
        orderBy: { startsAt: "asc" },
        take: 8,
      }),
      await tx.message.count({ where: { deletedAt: null, status: "DRAFT" } }),
      await tx.legalDraft.count({ where: { deletedAt: null, status: "DRAFT" } }),
      await tx.judgment.count({ where: { deletedAt: null, ...liveCase, appealFiledAt: null, appealDeadline: { gte: dayStart, lt: appealEnd } } }),
      await tx.judgment.findMany({
        where: { deletedAt: null, ...liveCase, appealFiledAt: null, appealDeadline: { gte: dayStart, lt: appealEnd } },
        select: { id: true, title: true, appealDeadline: true, legalCase: { select: { id: true, caseNumber: true } } },
        orderBy: { appealDeadline: "asc" },
        take: 6,
      }),
      await tx.legalCase.findMany({
        where: { deletedAt: null, status: { not: "CLOSED" }, updatedAt: { lt: staleBefore } },
        select: { id: true, caseNumber: true, title: true, updatedAt: true },
        orderBy: { updatedAt: "asc" },
        take: 6,
      }),
      await tx.legalCase.groupBy({ by: ["type"], where: { deletedAt: null, createdAt: { gte: since } }, _count: true }),
      await tx.auditLog.findMany({
        where: { action: { in: Object.keys(activityLabels) } },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { legalCase: { select: { id: true, caseNumber: true } } },
      }),
    ];

    return {
      counts: { clients, cases, drafts, legalDrafts, hearings: weekHearings, today: todayHearings.length, appeals },
      todayHearings,
      weekHearings: weekList,
      upcomingAppeals,
      staleCases,
      staleDays,
      byType: byType.map((row) => ({ type: row.type, count: row._count })),
      months,
      activity: activity.map((entry) => ({
        id: entry.id,
        label: activityLabels[entry.action],
        caseNumber: entry.legalCase?.caseNumber ?? null,
        caseId: entry.legalCase?.id ?? null,
        createdAt: entry.createdAt,
      })),
      canSeeOfficeActivity: user.role === Role.SENIOR_LAWYER,
    };
  });
});
