"use client";

import { AlertTriangle, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useUser } from "@/components/AppShell";
import { statusTone } from "@/components/case-status";
import { caseStatuses, caseTypes, courts, Empty, formatDateTime, FormModal, Loader, Modal, PageHead, Pill, send, useData, type Field } from "@/components/ui";
import { normalizeArabic } from "@/lib/text";

type Conflict = { kind: string; name: string; matched: string; caseNumber: string | null; href: string };
type Row = {
  id: string; caseNumber: string; title: string; type: string; court: string; courtCity: string | null; status: string;
  client: { id: string; name: string }; hearings: { startsAt: string }[];
};

export default function CasesPage() {
  const user = useUser();
  const { data, error, reload } = useData<{ cases: Row[] }>("/api/cases");
  const { data: clients } = useData<{ clients: { id: string; name: string }[] }>("/api/clients");
  const { data: team } = useData<{ staff: { id: string; name: string; role: string }[] }>("/api/team");
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<{ hits: Conflict[]; payload: object } | null>(null);
  const [failure, setFailure] = useState("");

  const lawyers = team?.staff.filter((member) => member.role !== "SECRETARY") ?? [];
  const fields: Field[] = [
    { name: "caseNumber", label: "رقم الدعوى", required: true, placeholder: "كما ورد في الملف" },
    { name: "title", label: "عنوان القضية", required: true },
    { name: "clientId", label: "العميل", type: "select", required: true, options: clients?.clients.map((client) => [client.id, client.name]) },
    { name: "type", label: "نوع القضية", type: "select", required: true, defaultValue: "CIVIL", options: Object.entries(caseTypes) },
    { name: "court", label: "درجة المحكمة", type: "select", required: true, defaultValue: "FIRST_INSTANCE", options: Object.entries(courts) },
    { name: "courtCity", label: "المدينة", placeholder: "عمان" },
    { name: "assignedLawyerId", label: "المحامي المسؤول", type: "select", required: true, defaultValue: user.id, options: lawyers.map((lawyer) => [lawyer.id, lawyer.name]) },
    { name: "traineeLawyerId", label: "المحامي المتدرب", type: "select", placeholder: "لا يوجد", options: lawyers.filter((lawyer) => lawyer.role === "TRAINEE_LAWYER").map((lawyer) => [lawyer.id, lawyer.name]) },
    { name: "opposingParties", label: "الخصوم", placeholder: "افصل بين الأسماء بفاصلة عربية" },
    { name: "mojCourt", label: "موقع المحكمة (كما في الوزارة)", placeholder: "قصر عدل عمان" },
    { name: "mojJurisdiction", label: "الاختصاص" },
    { name: "mojRegistry", label: "السجل" },
    { name: "mojNumber", label: "رقم القضية في الوزارة", placeholder: "343", dir: "ltr" },
    { name: "mojYear", label: "السنة", type: "number", placeholder: "2021" },
    { name: "fees", label: "الأتعاب بالدينار", type: "number" },
    { name: "summary", label: "موجز القضية", type: "textarea" },
  ];

  const rows = data?.cases.filter((row) =>
    normalizeArabic(`${row.caseNumber} ${row.title} ${row.client.name}`).includes(normalizeArabic(filter)) && (!status || row.status === status)) ?? [];

  async function proceed() {
    if (!conflict) return;
    setFailure("");
    try {
      await send("/api/cases", "POST", { ...conflict.payload, acknowledgeConflict: true });
      setConflict(null);
      await reload();
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر الحفظ.");
    }
  }

  return (
    <>
      <PageHead title="القضايا" subtitle="متابعة الملفات وحالتها ومواعيدها." action={user.role === "SENIOR_LAWYER" && <button className="btn btn-gold" onClick={() => setCreating(true)}><Plus size={17} /> قضية جديدة</button>} />
      <div className="filters">
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="ابحث برقم الدعوى أو العميل..." aria-label="بحث في القضايا" />
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="الحالة">
          <option value="">كل الحالات</option>
          {Object.entries(caseStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : rows.length === 0 ? <Empty title="لا توجد قضايا مطابقة" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>رقم الدعوى / الموضوع</th><th>العميل</th><th>النوع والمحكمة</th><th>الحالة</th><th>الجلسة القادمة</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id}>
                <td><Link href={`/app/cases/${row.id}`}><b>{row.caseNumber}</b><small>{row.title}</small></Link></td>
                <td>{row.client.name}</td>
                <td>{caseTypes[row.type]}<small>{courts[row.court]}{row.courtCity ? ` ${row.courtCity}` : ""}</small></td>
                <td><Pill tone={statusTone(row.status)}>{caseStatuses[row.status]}</Pill></td>
                <td>{row.hearings[0] ? formatDateTime(row.hearings[0].startsAt) : "غير محدد"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {creating && (
        <FormModal
          title="إنشاء قضية"
          fields={fields}
          note="تُسجّل القضية دون افتراض إجراء أو موعد قانوني. راجع البيانات قبل الحفظ."
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            const parties = String(values.opposingParties ?? "").split("،").map((name) => name.trim()).filter(Boolean);
            const payload = { ...values, opposingParties: parties };
            const { conflicts } = await send<{ conflicts: Conflict[] }>("/api/cases/conflicts", "POST", { clientId: values.clientId, opposingParties: parties });
            if (conflicts.length) {
              setConflict({ hits: conflicts, payload });
              return;
            }
            await send("/api/cases", "POST", payload);
            await reload();
          }}
        />
      )}
      {conflict && (
        <Modal title="تحذير تعارض مصالح" onClose={() => setConflict(null)}>
          <div className="notice notice-gold"><AlertTriangle size={17} /> وُجدت أسماء مطابقة في السجلات. راجعها قبل فتح القضية.</div>
          <ul className="rows conflict-list">{conflict.hits.map((hit, index) => (
            <li key={index}><Link href={hit.href}>{hit.name}<small>{hit.kind === "opposing" ? "ورد خصماً" : "مسجل عميلاً"}: {hit.matched}{hit.caseNumber ? ` — القضية ${hit.caseNumber}` : ""}</small></Link></li>
          ))}</ul>
          {failure && <div className="notice notice-error">{failure}</div>}
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => setConflict(null)}>إلغاء</button>
            <button className="btn btn-danger" onClick={() => void proceed()}>راجعت التعارض، افتح القضية</button>
          </div>
        </Modal>
      )}
    </>
  );
}
