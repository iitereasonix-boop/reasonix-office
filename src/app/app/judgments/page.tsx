"use client";

import { Check, Gavel, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useUser } from "@/components/AppShell";
import { Confirm, dayKey, Empty, formatDate, FormModal, Loader, PageHead, Pill, send, useData, type Field } from "@/components/ui";

type Judgment = {
  id: string; judgmentNumber: string | null; title: string; court: string | null; decidedAt: string; notifiedAt: string | null; summary: string;
  appealDeadline: string | null; appealFiledAt: string | null; proposedDeadline: string | null; deadlineRule: { explanation: string } | null;
  legalCase: { id: string; caseNumber: string; title: string; client: { name: string } };
};

export default function JudgmentsPage() {
  const user = useUser();
  const { data, error, reload } = useData<{ judgments: Judgment[] }>("/api/judgments");
  const { data: cases } = useData<{ cases: { id: string; caseNumber: string; title: string }[] }>("/api/cases");
  const [editing, setEditing] = useState<Judgment | "new" | null>(null);
  const [removing, setRemoving] = useState<Judgment | null>(null);
  const { data: office } = useData<{ rules: { id: string; name: string; days: number }[] }>("/api/office");
  const [confirming, setConfirming] = useState<Judgment | null>(null);
  const [failure, setFailure] = useState("");
  const senior = user.role === "SENIOR_LAWYER";

  const fields = (judgment?: Judgment): Field[] => [
    ...(judgment ? [] : [{ name: "caseId", label: "القضية", type: "select", required: true, wide: true, options: cases?.cases.map((item) => [item.id, `${item.caseNumber} — ${item.title}`]) } as Field]),
    { name: "judgmentNumber", label: "رقم الحكم", defaultValue: judgment?.judgmentNumber ?? undefined },
    { name: "title", label: "عنوان الحكم", required: true, defaultValue: judgment?.title },
    { name: "court", label: "المحكمة", defaultValue: judgment?.court ?? undefined },
    { name: "decidedAt", label: "تاريخ الحكم", type: "date", required: true, defaultValue: judgment ? dayKey(judgment.decidedAt) : undefined },
    { name: "notifiedAt", label: "تاريخ التبليغ", type: "date", defaultValue: judgment?.notifiedAt ? dayKey(judgment.notifiedAt) : undefined },
    { name: "ruleId", label: "قاعدة حساب موعد الطعن", type: "select", placeholder: office?.rules.length ? "دون حساب" : "لا توجد قواعد (أضفها من الإعدادات)", options: office?.rules.map((rule) => [rule.id, `${rule.name} (${rule.days} يوماً)`]) },
    { name: "appealDeadline", label: "آخر موعد للطعن (إدخال يدوي)", type: "date", defaultValue: judgment?.appealDeadline ? dayKey(judgment.appealDeadline) : undefined },
    { name: "appealFiledAt", label: "تاريخ تقديم الطعن", type: "date", defaultValue: judgment?.appealFiledAt ? dayKey(judgment.appealFiledAt) : undefined },
    { name: "summary", label: "منطوق الحكم أو ملخصه", type: "textarea", required: true, rows: 4, defaultValue: judgment?.summary },
  ];

  return (
    <>
      <PageHead title="الأحكام" subtitle="الأحكام الصادرة ومواعيد الطعن بعد تأكيد المحامي." action={senior && <button className="btn btn-gold" onClick={() => setEditing("new")}><Plus size={17} /> تسجيل حكم</button>} />
      {failure && <div className="notice notice-error">{failure}</div>}
      {data?.judgments.filter((judgment) => judgment.proposedDeadline).map((judgment) => (
        <div className="notice notice-gold deadline-note" key={judgment.id}>
          <span><b>موعد مقترح للحكم «{judgment.title}»: {formatDate(judgment.proposedDeadline as string)}</b><br />{judgment.deadlineRule?.explanation}</span>
          {senior && <span className="row-actions">
            <button className="btn btn-gold btn-sm" onClick={() => setConfirming(judgment)}><Check size={15} /> مراجعة وتأكيد</button>
            <button className="btn btn-ghost btn-sm" onClick={() => void send(`/api/judgments?id=${judgment.id}`, "PATCH", { action: "dismissDeadline" }).then(reload).catch((issue: Error) => setFailure(issue.message))}><X size={15} /> تجاهل</button>
          </span>}
        </div>
      ))}
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : data.judgments.length === 0 ? <Empty title="لا توجد أحكام مسجلة" icon={<Gavel size={28} />} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>الحكم</th><th>القضية</th><th>التاريخ</th><th>موعد الطعن</th>{senior && <th aria-label="إجراءات" />}</tr></thead>
            <tbody>{data.judgments.map((judgment) => {
              const days = judgment.appealDeadline ? Math.ceil((new Date(judgment.appealDeadline).getTime() - Date.now()) / 86_400_000) : null;
              return (
                <tr key={judgment.id}>
                  <td className="wrap"><b>{judgment.title}</b><small>{judgment.judgmentNumber ? `رقم ${judgment.judgmentNumber} · ` : ""}{judgment.summary}</small></td>
                  <td><Link href={`/app/cases/${judgment.legalCase.id}`}><b>{judgment.legalCase.caseNumber}</b><small>{judgment.legalCase.client.name}</small></Link></td>
                  <td>{formatDate(judgment.decidedAt)}</td>
                  <td>{judgment.appealDeadline ? <Pill tone={days !== null && days < 0 ? "neutral" : days !== null && days <= 14 ? "warn" : "info"}>{formatDate(judgment.appealDeadline)}</Pill> : "—"}{judgment.appealFiledAt && <small>طُعن في {formatDate(judgment.appealFiledAt)}</small>}</td>
                  {senior && <td className="row-actions">
                    <button className="icon-btn" aria-label="تعديل الحكم" onClick={() => setEditing(judgment)}><Pencil size={15} /></button>
                    <button className="icon-btn" aria-label="حذف الحكم" onClick={() => setRemoving(judgment)}><Trash2 size={15} /></button>
                  </td>}
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
      {editing && (
        <FormModal
          title={editing === "new" ? "تسجيل حكم" : "تعديل الحكم"}
          fields={fields(editing === "new" ? undefined : editing)}
          note="القاعدة تنتج موعداً مقترحاً يبقى بلا أثر حتى تؤكده، وتراعي العطل المدخلة في الإعدادات حسب إعداد القاعدة. عند التأكيد تُنشأ مهمة للمحامي المسؤول بتاريخ آخر يوم."
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            await (editing === "new" ? send("/api/judgments", "POST", values) : send(`/api/judgments?id=${editing.id}`, "PATCH", values));
            await reload();
          }}
        />
      )}
      {confirming && <Confirm title="تأكيد موعد الطعن" body={`${confirming.deadlineRule?.explanation ?? ""}. الموعد الناتج: ${formatDate(confirming.proposedDeadline as string)}. لا يراعي الحساب العطل. راجعه مع الملف قبل التأكيد.`} action="أؤكد الموعد" onClose={() => setConfirming(null)} onConfirm={async () => { await send(`/api/judgments?id=${confirming.id}`, "PATCH", { action: "confirmDeadline" }); await reload(); }} />}
      {removing && <Confirm title="حذف الحكم" body={`حذف «${removing.title}» من السجل؟`} action="حذف" danger onClose={() => setRemoving(null)} onConfirm={async () => { await send(`/api/judgments?id=${removing.id}`, "DELETE"); await reload(); }} />}
    </>
  );
}
