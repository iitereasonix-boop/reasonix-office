"use client";

import { CheckCircle2, FileSearch, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useUser } from "@/components/AppShell";
import { caseTypes, courts, DOCUMENT_ACCEPT, Empty, FormModal, Loader, PageHead, Pill, request, send, useData, type Field } from "@/components/ui";

type Part = { value: string | null; quote: string | null };
type Item = {
  id: string; fileName: string; status: string; matchedClientId: string | null; matchScore: number | null; reviewNote: string | null; courtLevel: string | null;
  extracted: { client_name: Part; case_number: Part; court: Part; hearing_date: Part } | null;
};

function Value({ part }: { part?: Part }) {
  if (!part?.value) return <span className="muted">غير مذكور</span>;
  return <span title={part.quote ?? undefined}>{part.value}</span>;
}

export default function IntakePage() {
  const user = useUser();
  const router = useRouter();
  const { data, error, reload } = useData<{ items: Item[] }>("/api/intake");
  const { data: clients } = useData<{ clients: { id: string; name: string }[] }>("/api/clients");
  const { data: team } = useData<{ staff: { id: string; name: string; role: string }[] }>("/api/team");
  const [accepting, setAccepting] = useState<Item | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const senior = user.role === "SENIOR_LAWYER";

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    setBusy(true);
    setFailure("");
    try {
      await request("/api/intake", { method: "POST", body: form });
      await reload();
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر رفع الملفات.");
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: string) {
    await send(`/api/intake?id=${id}`, "PATCH", { action: "reject" });
    await reload();
  }

  const clientName = (id: string | null) => clients?.clients.find((client) => client.id === id)?.name;
  const fields = (item: Item): Field[] => [
    { name: "clientId", label: "العميل", type: "select", required: true, wide: true, defaultValue: item.matchedClientId ?? undefined, options: clients?.clients.map((client) => [client.id, client.name]) },
    { name: "caseNumber", label: "رقم الدعوى", required: true, defaultValue: item.extracted?.case_number.value ?? undefined },
    { name: "title", label: "عنوان القضية", required: true },
    { name: "type", label: "النوع", type: "select", required: true, defaultValue: "CIVIL", options: Object.entries(caseTypes) },
    { name: "court", label: "درجة المحكمة", type: "select", required: true, defaultValue: item.courtLevel ?? "FIRST_INSTANCE", options: Object.entries(courts) },
    { name: "assignedLawyerId", label: "المحامي المسؤول", type: "select", required: true, defaultValue: user.id, options: team?.staff.filter((member) => member.role !== "SECRETARY").map((member) => [member.id, member.name]) },
    { name: "hearingAt", label: "موعد الجلسة", type: "datetime-local" },
  ];

  return (
    <>
      <PageHead
        title="توزيع الملفات"
        subtitle="يقرأ الوكيل الملفات ويقترح الربط بالعملاء، ولا يُحفظ شيء قبل مراجعتك."
        action={<button className="btn btn-gold" disabled={busy} onClick={() => input.current?.click()}><Upload size={17} /> {busy ? "جارٍ القراءة..." : "رفع ملفات"}</button>}
      />
      <input ref={input} type="file" hidden multiple accept={DOCUMENT_ACCEPT} onChange={upload} />
      {failure && <div className="notice notice-error">{failure}</div>}
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : data.items.length === 0 ? <Empty title="لا توجد ملفات بانتظار المراجعة" hint="ارفع PDF أو Word أو صوراً." icon={<FileSearch size={28} />} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>الملف</th><th>الموكّل</th><th>رقم الدعوى</th><th>المحكمة</th><th>موعد الجلسة</th><th>الربط المقترح</th><th>الحالة</th><th aria-label="إجراءات" /></tr></thead>
            <tbody>{data.items.map((item) => (
              <tr key={item.id}>
                <td className="wrap"><b>{item.fileName}</b>{item.reviewNote && <small>{item.reviewNote}</small>}</td>
                <td><Value part={item.extracted?.client_name} /></td>
                <td><Value part={item.extracted?.case_number} /></td>
                <td><Value part={item.extracted?.court} /></td>
                <td><Value part={item.extracted?.hearing_date} /></td>
                <td>{clientName(item.matchedClientId) ?? "—"}{item.matchScore ? <small>تطابق {Math.round(item.matchScore * 100)}٪</small> : null}</td>
                <td><Pill tone={item.status === "SUGGESTED" ? "good" : "warn"}>{item.status === "SUGGESTED" ? "اقتراح جاهز" : "تحتاج مراجعة"}</Pill></td>
                <td className="row-actions">
                  {senior && <button className="icon-btn" aria-label={`اعتماد ${item.fileName}`} onClick={() => setAccepting(item)}><CheckCircle2 size={17} /></button>}
                  <button className="icon-btn" aria-label={`رفض ${item.fileName}`} onClick={() => void reject(item.id)}><X size={17} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <p className="form-note">لا عميل مطابق؟ <Link className="link-btn" href="/app/clients">أضف العميل</Link> ثم اعتمد الملف.</p>
      {accepting && (
        <FormModal
          title="مراجعة وفتح القضية"
          fields={fields(accepting)}
          note="يُفتح الملف كقضية جديدة ويُرفق المستند بها بعد مراجعتك لكل حقل."
          submitLabel="حفظ القضية"
          onClose={() => setAccepting(null)}
          onSubmit={async (values) => {
            const { caseId } = await send<{ caseId: string }>(`/api/intake?id=${accepting.id}`, "PATCH", { ...values, action: "accept" });
            router.push(`/app/cases/${caseId}`);
          }}
        />
      )}
    </>
  );
}
