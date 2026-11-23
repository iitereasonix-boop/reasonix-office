import { route, staffRoles } from "@/lib/api";
import { withDatabaseAccess } from "@/lib/auth";
import { normalizeArabic } from "@/lib/text";

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""').replace(/^[=+\-@]/, "'$&")}"`;

export const GET = route(staffRoles, async (user, request) => {
  const months = Math.min(Number(request.nextUrl.searchParams.get("months")) || 6, 24);
  const data = await withDatabaseAccess(user, async (tx) => {
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const cases = await tx.legalCase.findMany({
      where: { deletedAt: null },
      select: { caseNumber: true, title: true, type: true, court: true, status: true, createdAt: true, client: { select: { name: true } }, assignedLawyer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    const hearings = await tx.hearing.findMany({ where: { deletedAt: null, startsAt: { gte: since } }, select: { startsAt: true } });
    const decided = await tx.hearing.findMany({
      where: { deletedAt: null, decision: { not: null }, startsAt: { gte: since } },
      select: { decision: true, legalCase: { select: { court: true } } },
    });
    const tasks = await tx.task.findMany({ where: { deletedAt: null }, select: { completedAt: true, dueAt: true } });
    const drafts = await tx.legalDraft.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true });
    return { cases, hearings, decided, tasks, drafts, since };
  });

  if (request.nextUrl.searchParams.get("format") === "csv") {
    const header = ["رقم الدعوى", "الموضوع", "العميل", "المحامي", "النوع", "المحكمة", "الحالة", "تاريخ الفتح"];
    const rows = data.cases.map((row) => [row.caseNumber, row.title, row.client.name, row.assignedLawyer.name, row.type, row.court, row.status, row.createdAt.toISOString().slice(0, 10)]);
    const csv = `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=reasonix-cases.csv", "Cache-Control": "private, no-store" },
    });
  }

  const tally = <K extends string>(keys: K[]) => {
    const counts = new Map<K, number>();
    keys.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));
    return [...counts].map(([key, count]) => ({ key, count }));
  };
  const monthKeys = Array.from({ length: months }, (_, index) => {
    const date = new Date(data.since.getFullYear(), data.since.getMonth() + index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
  const monthOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const now = new Date();
  return {
    total: data.cases.length,
    byType: tally(data.cases.map((row) => row.type)),
    byStatus: tally(data.cases.map((row) => row.status)),
    byCourt: tally(data.cases.map((row) => row.court)),
    // Rate among hearings with a recorded decision, because an empty decision says nothing either way.
    adjournments: [...new Set(data.decided.map((row) => row.legalCase.court))].map((court) => {
      const rows = data.decided.filter((row) => row.legalCase.court === court);
      const adjourned = rows.filter((row) => normalizeArabic(row.decision ?? "").includes("تاجيل")).length;
      return { key: court, total: rows.length, adjourned, rate: Math.round((adjourned / rows.length) * 100) };
    }),
    perMonth: monthKeys.map((month) => ({
      month,
      hearings: data.hearings.filter((row) => monthOf(row.startsAt) === month).length,
      cases: data.cases.filter((row) => monthOf(row.createdAt) === month).length,
    })),
    tasks: {
      open: data.tasks.filter((task) => !task.completedAt).length,
      done: data.tasks.filter((task) => task.completedAt).length,
      overdue: data.tasks.filter((task) => !task.completedAt && task.dueAt && task.dueAt < now).length,
    },
    drafts: data.drafts.map((row) => ({ status: row.status, count: row._count })),
  };
});
