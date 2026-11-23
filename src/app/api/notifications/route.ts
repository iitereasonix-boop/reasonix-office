import { Role } from "@prisma/client";
import { route, staffRoles } from "@/lib/api";
import { withDatabaseAccess } from "@/lib/auth";
import { addDays, ammanDayStart } from "@/lib/dates";

// Alerts are derived from live records, so one clears itself once its cause is handled.
export const GET = route(staffRoles, async (user) => {
  const notifications = await withDatabaseAccess(user, async (tx) => {
    const now = new Date();
    const start = ammanDayStart(now);
    const tomorrow = addDays(start, 2);
    const appealEnd = addDays(start, 14);
    const seesRequests = user.role !== Role.TRAINEE_LAWYER;

    const hearings = await tx.hearing.findMany({
      where: { deletedAt: null, startsAt: { gte: now, lt: tomorrow }, legalCase: { deletedAt: null } },
      include: { legalCase: { select: { id: true, caseNumber: true } } },
      orderBy: { startsAt: "asc" },
      take: 5,
    });
    const appeals = await tx.judgment.findMany({
      orderBy: { appealDeadline: "asc" },
      where: { deletedAt: null, appealFiledAt: null, appealDeadline: { gte: start, lt: appealEnd }, legalCase: { deletedAt: null } },
      include: { legalCase: { select: { caseNumber: true } } },
      take: 5,
    });
    const overdue = await tx.task.count({ where: { deletedAt: null, completedAt: null, assigneeId: user.id, dueAt: { lt: now } } });
    const pendingDrafts = user.role === Role.SENIOR_LAWYER ? await tx.legalDraft.count({ where: { deletedAt: null, status: "DRAFT" } }) : 0;
    const pendingMessages = user.role === Role.SENIOR_LAWYER ? await tx.message.count({ where: { deletedAt: null, status: "DRAFT" } }) : 0;
    const proposed = user.role === Role.SENIOR_LAWYER ? await tx.judgment.count({ where: { deletedAt: null, proposedDeadline: { not: null }, deadlineConfirmedAt: null } }) : 0;
    const intake = seesRequests ? await tx.intakeItem.count({ where: { status: { in: ["SUGGESTED", "NEEDS_REVIEW"] } } }) : 0;
    const inbound = seesRequests ? await tx.message.count({ where: { deletedAt: null, direction: "INBOUND", createdAt: { gte: addDays(now, -1) } } }) : 0;
    const requests = seesRequests ? await tx.consultationRequest.count({ where: { status: "NEW" } }) : 0;

    return [
      ...hearings.map((hearing) => ({ id: `h-${hearing.id}`, tone: "info", title: `جلسة القضية ${hearing.legalCase.caseNumber}`, at: hearing.startsAt, href: `/app/cases/${hearing.legalCase.id}` })),
      ...appeals.map((judgment) => {
        const days = Math.round(((judgment.appealDeadline as Date).getTime() - start.getTime()) / 86_400_000);
        const when = days <= 0 ? "اليوم آخر يوم" : days === 1 ? "غداً آخر يوم" : `باقي ${days} أيام`;
        return { id: `j-${judgment.id}`, tone: days <= 3 ? "critical" : "warning", title: `طعن القضية ${judgment.legalCase.caseNumber}: ${when}`, at: judgment.appealDeadline, href: "/app/judgments" };
      }),
      ...(proposed ? [{ id: "deadlines", tone: "warning", title: `${proposed} موعد طعن مقترح بانتظار تأكيدك`, at: null, href: "/app/judgments" }] : []),
      ...(intake ? [{ id: "intake", tone: "info", title: `${intake} ملف بانتظار مراجعة التوزيع`, at: null, href: "/app/intake" }] : []),
      ...(inbound ? [{ id: "inbound", tone: "info", title: `${inbound} رسالة واردة خلال آخر يوم`, at: null, href: "/app/whatsapp" }] : []),
      ...(requests ? [{ id: "requests", tone: "info", title: `${requests} طلب استشارة جديد`, at: null, href: "/app/consultations" }] : []),
      ...(overdue ? [{ id: "tasks", tone: "warning", title: `${overdue} مهمة متأخرة`, at: null, href: "/app/tasks" }] : []),
      ...(pendingDrafts ? [{ id: "drafts", tone: "info", title: `${pendingDrafts} مسودة قانونية بانتظار الاعتماد`, at: null, href: "/app/documents?tab=drafts" }] : []),
      ...(pendingMessages ? [{ id: "messages", tone: "info", title: `${pendingMessages} رسالة واتساب بانتظار الاعتماد`, at: null, href: "/app/whatsapp" }] : []),
    ];
  });
  return { notifications };
});
