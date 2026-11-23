"use client";

import { Download, Printer } from "lucide-react";
import { useState } from "react";
import { BarList, Donut, MonthBars } from "@/components/charts";
import { statusTone, typeColor } from "@/components/case-status";
import { caseStatuses, caseTypes, courts, draftStatuses, Empty, Loader, PageHead, useData } from "@/components/ui";

type Report = {
  total: number;
  byType: { key: string; count: number }[];
  byStatus: { key: string; count: number }[];
  byCourt: { key: string; count: number }[];
  perMonth: { month: string; hearings: number; cases: number }[];
  tasks: { open: number; done: number; overdue: number };
  drafts: { status: string; count: number }[];
  adjournments: { key: string; total: number; adjourned: number; rate: number }[];
};

const monthLabel = (key: string, compact: boolean) => (compact ? String(Number(key.slice(5))) : new Intl.DateTimeFormat("ar-JO", { month: "short" }).format(new Date(`${key}-15`)));

export default function ReportsPage() {
  const [months, setMonths] = useState(6);
  const { data, error, reload } = useData<Report>(`/api/reports?months=${months}`);
  if (!data) return <Loader error={error} retry={reload} />;
  const neutral = () => "var(--cat-1)";
  const statusColor = (key: string) => `var(--tone-${statusTone(key)})`;

  return (
    <>
      <PageHead
        title="التقارير والتحليلات"
        subtitle={`${data.total} قضية في السجل`}
        action={
          <div className="head-actions no-print">
            <select className="mini-select" aria-label="الفترة" value={months} onChange={(event) => setMonths(Number(event.target.value))}>
              <option value={3}>آخر 3 أشهر</option><option value={6}>آخر 6 أشهر</option><option value={12}>آخر 12 شهراً</option>
            </select>
            <a className="btn btn-ghost" href="/api/reports?format=csv"><Download size={16} /> تصدير CSV</a>
            <button className="btn btn-gold" onClick={() => window.print()}><Printer size={16} /> طباعة</button>
          </div>
        }
      />
      <section className="stats">
        <div className="stat"><div><b>{data.tasks.open}</b><small>مهام مفتوحة</small></div></div>
        <div className="stat"><div><b>{data.tasks.overdue}</b><small>مهام متأخرة</small></div></div>
        <div className="stat"><div><b>{data.tasks.done}</b><small>مهام منجزة</small></div></div>
        <div className="stat"><div><b>{data.drafts.find((row) => row.status === "DRAFT")?.count ?? 0}</b><small>{draftStatuses.DRAFT}</small></div></div>
      </section>
      <div className="report-grid">
        <section className="card"><header className="card-head"><h2>القضايا حسب النوع</h2></header>
          <Donut slices={data.byType.map(({ key, count }) => ({ key, label: caseTypes[key], value: count }))} unit="قضية" colorOf={typeColor} />
        </section>
        <section className="card"><header className="card-head"><h2>القضايا حسب الحالة</h2></header>
          <BarList rows={data.byStatus.map(({ key, count }) => ({ key, label: caseStatuses[key], value: count }))} colorOf={statusColor} />
        </section>
        <section className="card"><header className="card-head"><h2>الجلسات شهرياً</h2></header>
          <MonthBars label="عدد الجلسات في كل شهر" rows={data.perMonth.map(({ month, hearings }) => ({ key: month, label: monthLabel(month, months > 6), value: hearings }))} />
        </section>
        <section className="card"><header className="card-head"><h2>القضايا حسب درجة المحكمة</h2></header>
          <BarList rows={data.byCourt.map(({ key, count }) => ({ key, label: courts[key], value: count }))} colorOf={neutral} />
        </section>
        <section className="card"><header className="card-head"><h2>معدل التأجيل حسب المحكمة (٪)</h2></header>
          {data.adjournments.length ? <BarList rows={data.adjournments.map(({ key, rate }) => ({ key, label: courts[key], value: rate }))} colorOf={neutral} /> : <Empty title="لا توجد قرارات جلسات في هذه الفترة" />}
        </section>
      </div>
    </>
  );
}
