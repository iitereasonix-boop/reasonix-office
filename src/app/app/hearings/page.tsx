"use client";

import { CalendarDays, CalendarPlus, Download, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useUser } from "@/components/AppShell";
import { Confirm, dayKey, Empty, formatDate, formatTime, FormModal, Loader, PageHead, send, useData } from "@/components/ui";

type Hearing = { id: string; startsAt: string; purpose: string | null; courtroom: string | null; legalCase: { id: string; caseNumber: string; title: string; courtCity: string | null; client: { name: string } } };

const googleDates = (start: string) => {
  const stamp = (value: Date) => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `${stamp(new Date(start))}/${stamp(new Date(new Date(start).getTime() + 3_600_000))}`;
};

function Hearings() {
  const user = useUser();
  const params = useSearchParams();
  const [date, setDate] = useState(params.get("date") ?? "");
  const range = date ? `?from=${new Date(`${date}T00:00:00+03:00`).toISOString()}&to=${new Date(`${date}T23:59:59+03:00`).toISOString()}` : "";
  const { data, error, reload } = useData<{ hearings: Hearing[] }>(`/api/hearings${range}`);
  const { data: cases } = useData<{ cases: { id: string; caseNumber: string; title: string }[] }>("/api/cases");
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Hearing | null>(null);
  const canEdit = user.role !== "TRAINEE_LAWYER";

  return (
    <>
      <PageHead title="الجلسات" subtitle={date ? `جلسات يوم ${date.replaceAll("-", "/")}` : "الجلسات القادمة للقضايا المتاحة لك."} action={<div className="head-actions"><a className="btn btn-ghost" href="/api/calendar"><Download size={16} /> تصدير ICS</a>{canEdit && <button className="btn btn-gold" onClick={() => setCreating(true)}><Plus size={17} /> تسجيل جلسة</button>}</div>} />
      <div className="filters">
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="التاريخ" />
        {date && <button className="btn btn-ghost btn-sm" onClick={() => setDate("")}><X size={15} /> كل المواعيد</button>}
      </div>
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : data.hearings.length === 0 ? <Empty title="لا توجد جلسات" icon={<CalendarDays size={28} />} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>التاريخ</th><th>الوقت</th><th>القضية</th><th>العميل</th><th>الغرض</th><th>القاعة</th><th aria-label="إجراءات" /></tr></thead>
            <tbody>{data.hearings.map((hearing) => (
              <tr key={hearing.id} className={dayKey(hearing.startsAt) === dayKey(new Date()) ? "row-today" : ""}>
                <td>{formatDate(hearing.startsAt)}</td>
                <td>{formatTime(hearing.startsAt)}</td>
                <td><Link href={`/app/cases/${hearing.legalCase.id}`}><b>{hearing.legalCase.caseNumber}</b><small>{hearing.legalCase.title}</small></Link></td>
                <td>{hearing.legalCase.client.name}</td>
                <td>{hearing.purpose ?? "—"}</td>
                <td>{hearing.courtroom ?? "—"}</td>
                <td className="row-actions"><a className="icon-btn" aria-label="إضافة إلى تقويم Google" target="_blank" rel="noreferrer" href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`جلسة القضية ${hearing.legalCase.caseNumber}`)}&dates=${googleDates(hearing.startsAt)}`}><CalendarPlus size={15} /></a>{canEdit && <button className="icon-btn" aria-label="حذف الجلسة" onClick={() => setRemoving(hearing)}><Trash2 size={15} /></button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {creating && (
        <FormModal
          title="تسجيل جلسة"
          fields={[
            { name: "caseId", label: "القضية", type: "select", required: true, wide: true, options: cases?.cases.map((item) => [item.id, `${item.caseNumber} — ${item.title}`]) },
            { name: "startsAt", label: "التاريخ والوقت", type: "datetime-local", required: true, defaultValue: date ? `${date}T09:30` : undefined },
            { name: "courtroom", label: "القاعة" },
            { name: "judge", label: "القاضي" },
            { name: "purpose", label: "الغرض من الجلسة", wide: true },
          ]}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => { await send("/api/hearings", "POST", values); await reload(); }}
        />
      )}
      {removing && <Confirm title="حذف الجلسة" body={`حذف جلسة القضية ${removing.legalCase.caseNumber} بتاريخ ${formatDate(removing.startsAt)}؟`} action="حذف" danger onClose={() => setRemoving(null)} onConfirm={async () => { await send(`/api/hearings?id=${removing.id}`, "DELETE"); await reload(); }} />}
    </>
  );
}

export default function HearingsPage() {
  return <Suspense><Hearings /></Suspense>;
}
