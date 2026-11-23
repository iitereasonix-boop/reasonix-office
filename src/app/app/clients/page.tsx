"use client";

import { Eye, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useUser } from "@/components/AppShell";
import { Confirm, Empty, FormModal, Loader, PageHead, Pill, request, send, useData, type Field } from "@/components/ui";
import { normalizeArabic } from "@/lib/text";

type Client = { id: string; name: string; phone: string; address: string | null; nationalId: string | null; notes: string | null; whatsappOptOutAt: string | null; _count: { cases: number } };

function Clients() {
  const user = useUser();
  const params = useSearchParams();
  const { data, error, reload } = useData<{ clients: Client[] }>("/api/clients");
  const [filter, setFilter] = useState(params.get("q") ?? "");
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [removing, setRemoving] = useState<Client | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const canEdit = user.role !== "TRAINEE_LAWYER";

  const fields = (client?: Client): Field[] => [
    { name: "name", label: "اسم العميل", required: true, defaultValue: client?.name },
    { name: "phone", label: "رقم الهاتف", type: "tel", required: true, dir: "ltr", defaultValue: client?.phone, placeholder: "+962 7X XXX XXXX" },
    ...(user.canViewNationalId ? [{ name: "nationalId", label: client?.nationalId ? "الرقم الوطني (اتركه فارغاً للإبقاء عليه)" : "الرقم الوطني", dir: "ltr" } as Field] : []),
    { name: "address", label: "العنوان", defaultValue: client?.address ?? undefined },
    ...(user.canViewPrivateNotes ? [{ name: "notes", label: "ملاحظات", type: "textarea", defaultValue: client?.notes ?? undefined } as Field] : []),
  ];

  const rows = data?.clients.filter((client) => normalizeArabic(`${client.name} ${client.phone}`).includes(normalizeArabic(filter))) ?? [];

  async function reveal(id: string) {
    setFailure("");
    try {
      const { nationalId } = await request<{ nationalId: string }>(`/api/clients/reveal?id=${id}`);
      setRevealed((current) => ({ ...current, [id]: nationalId }));
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر عرض الرقم.");
    }
  }

  return (
    <>
      <PageHead title="العملاء" subtitle="بيانات العملاء والقضايا المرتبطة بهم." action={canEdit && <button className="btn btn-gold" onClick={() => setEditing("new")}><Plus size={17} /> إضافة عميل</button>} />
      <div className="filters"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="ابحث بالاسم أو الهاتف..." aria-label="بحث في العملاء" /></div>
      {failure && <div className="notice notice-error">{failure}</div>}
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : rows.length === 0 ? <Empty title="لا يوجد عملاء مطابقون" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>اسم العميل</th><th>الهاتف</th><th>الرقم الوطني</th><th>القضايا</th><th>العنوان</th>{canEdit && <th aria-label="إجراءات" />}</tr></thead>
            <tbody>{rows.map((client) => (
              <tr key={client.id}>
                <td><b>{client.name}</b>{client.whatsappOptOutAt && <Pill tone="warn">ألغى واتساب</Pill>}</td>
                <td dir="ltr" className="align-start">{client.phone}</td>
                <td dir="ltr" className="align-start">{revealed[client.id] ?? client.nationalId ?? <span className="muted"><Lock size={13} /> محمي</span>}{client.nationalId && !revealed[client.id] && <button className="icon-btn" aria-label={`إظهار الرقم الوطني لـ ${client.name}`} onClick={() => void reveal(client.id)}><Eye size={14} /></button>}</td>
                <td>{client._count.cases}</td>
                <td>{client.address ?? "—"}</td>
                {canEdit && <td className="row-actions">
                  <button className="icon-btn" aria-label={`تعديل ${client.name}`} onClick={() => setEditing(client)}><Pencil size={15} /></button>
                  <button className="icon-btn" aria-label={`حذف ${client.name}`} onClick={() => setRemoving(client)}><Trash2 size={15} /></button>
                </td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {editing && (
        <FormModal
          title={editing === "new" ? "إضافة عميل" : "تعديل بيانات العميل"}
          fields={fields(editing === "new" ? undefined : editing)}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            await (editing === "new" ? send("/api/clients", "POST", values) : send(`/api/clients?id=${editing.id}`, "PATCH", values));
            await reload();
          }}
        />
      )}
      {removing && <Confirm title="حذف العميل" body={`سيُخفى سجل ${removing.name} من القوائم.`} action="حذف" danger onClose={() => setRemoving(null)} onConfirm={async () => { await send(`/api/clients?id=${removing.id}`, "DELETE"); await reload(); }} />}
    </>
  );
}

export default function ClientsPage() {
  return <Suspense><Clients /></Suspense>;
}
