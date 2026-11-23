"use client";

import { ArrowRight, Bot, CalendarPlus, Copy, ExternalLink, Landmark, CheckSquare, ClipboardPlus, Eye, FileEdit, Gavel, History, MessageCircle, Pencil, Plus, Receipt, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useRef, useState } from "react";
import { useUser } from "@/components/AppShell";
import { CaseCosts } from "@/components/CaseCosts";
import { actionLabel, statusTone } from "@/components/case-status";
import {
  caseStatuses, caseTypes, Confirm, copyText, courts, Modal, documentCategories, DOCUMENT_ACCEPT, DocumentViewer, draftKinds, draftStatuses, Empty, formatDate, formatDateTime, FormModal, Loader, messageStatuses, money, PageHead, Pill, request, send, updateKinds, useData, type Field,
} from "@/components/ui";

type Hearing = { id: string; startsAt: string; purpose: string | null; courtroom: string | null; judge: string | null; notes: string | null; decision: string | null; nextStartsAt: string | null };
type CaseFile = {
  id: string; caseNumber: string; title: string; summary: string | null; type: string; court: string; courtCity: string | null; status: string;
  opposingParties: string[]; privateNotes: string | null; fees: string | null;
  mojCourt: string | null; mojJurisdiction: string | null; mojRegistry: string | null; mojNumber: string | null; mojYear: number | null;
  client: { id: string; name: string; phone: string; nationalId: string | null; whatsappOptOutAt: string | null };
  assignedLawyer: { name: string }; traineeLawyer: { name: string } | null;
  hearings: Hearing[];
  judgments: { id: string; title: string; decidedAt: string; summary: string; appealDeadline: string | null }[];
  tasks: { id: string; title: string; dueAt: string | null; completedAt: string | null; assignee: { name: string } }[];
  drafts: { id: string; title: string; kind: string; status: string; generatedByAi: boolean }[];
  documents: { id: string; title: string; pageCount: number; extraction: string; category: string; version: number; createdAt: string }[];
  messages: { id: string; body: string; status: string; direction: string; createdAt: string }[];
  updates: { id: string; kind: string; occurredAt: string; note: string; nextHearingAt: string | null; createdBy: { name: string } }[];
  invoices: { id: string; number: string; amount: string; issuedAt: string; payments: { amount: string }[] }[];
};

const toLocal = (value: string) => new Date(new Date(value).getTime() + 3 * 3_600_000).toISOString().slice(0, 16);

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useUser();
  const router = useRouter();
  const { data, error, reload } = useData<{ case: CaseFile; timeline: { id: string; action: string; createdAt: string; user: { name: string } }[] }>(`/api/cases?id=${id}`);
  const [modal, setModal] = useState<"" | "hearing" | "edit" | "update" | "remove" | "invoice" | "moj">("");
  const [copied, setCopied] = useState<"" | "done" | "failed">("");
  const [editingHearing, setEditingHearing] = useState<Hearing | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  if (!data) return <Loader error={error} retry={reload} />;
  const file = data.case;
  const senior = user.role === "SENIOR_LAWYER";
  const office = senior || user.role === "SECRETARY";
  const billed = file.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const paid = file.invoices.flatMap((invoice) => invoice.payments).reduce((sum, payment) => sum + Number(payment.amount), 0);

  const hearingFields = (hearing?: Hearing): Field[] => [
    { name: "startsAt", label: "التاريخ والوقت", type: "datetime-local", required: true, defaultValue: hearing ? toLocal(hearing.startsAt) : undefined },
    { name: "courtroom", label: "القاعة", defaultValue: hearing?.courtroom ?? undefined },
    { name: "judge", label: "القاضي", defaultValue: hearing?.judge ?? undefined },
    { name: "purpose", label: "الغرض من الجلسة", defaultValue: hearing?.purpose ?? undefined },
    ...(hearing ? [
      { name: "notes", label: "ما جرى في الجلسة", type: "textarea", defaultValue: hearing.notes ?? undefined } as Field,
      { name: "decision", label: "القرار", type: "textarea", defaultValue: hearing.decision ?? undefined } as Field,
      { name: "nextStartsAt", label: "موعد الجلسة التالية", type: "datetime-local", defaultValue: hearing.nextStartsAt ? toLocal(hearing.nextStartsAt) : undefined } as Field,
    ] : []),
  ];

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    const form = new FormData();
    form.set("file", chosen);
    form.set("caseId", file.id);
    setUploadError("");
    try {
      await request("/api/documents", { method: "POST", body: form });
      await reload();
    } catch (issue) {
      setUploadError(issue instanceof Error ? issue.message : "تعذر رفع الملف.");
    }
  }

  return (
    <>
      <Link href="/app/cases" className="back-link"><ArrowRight size={16} /> كل القضايا</Link>
      <PageHead
        title={`القضية ${file.caseNumber}`}
        subtitle={file.title}
        action={
          <div className="head-actions">
            {office && <button className="btn btn-gold" onClick={() => setModal("update")}><ClipboardPlus size={17} /> إضافة تحديث</button>}
            <Link className="btn btn-gold" href={`/app/assistant?case=${file.id}`}><Bot size={17} /> اسأل المساعد</Link>
            {senior && <button className="btn btn-ghost" onClick={() => setModal("edit")}><Pencil size={16} /> تعديل</button>}
            {senior && <button className="btn btn-ghost" onClick={() => setModal("remove")}><Trash2 size={16} /> حذف</button>}
          </div>
        }
      />

      <div className="case-grid">
        <section className="card facts">
          <dl>
            <div><dt>العميل</dt><dd>{file.client.name}<small dir="ltr">{file.client.phone}</small></dd></div>
            <div><dt>النوع</dt><dd>{caseTypes[file.type]}</dd></div>
            <div><dt>المحكمة</dt><dd>{courts[file.court]}{file.courtCity ? ` ${file.courtCity}` : ""}</dd></div>
            <div><dt>رقم القضية في الوزارة</dt><dd>{file.mojNumber && file.mojYear ? <span dir="ltr">{file.mojNumber}/{file.mojYear}</span> : <span className="muted">غير مدخل</span>}<button className="link-btn moj-btn" onClick={() => setModal("moj")}><Landmark size={14} /> استعلم بالوزارة</button></dd></div>
            <div><dt>الحالة</dt><dd><Pill tone={statusTone(file.status)}>{caseStatuses[file.status]}</Pill></dd></div>
            <div><dt>المحامي المسؤول</dt><dd>{file.assignedLawyer.name}</dd></div>
            {file.traineeLawyer && <div><dt>المتدرب</dt><dd>{file.traineeLawyer.name}</dd></div>}
            {file.opposingParties.length > 0 && <div><dt>الخصوم</dt><dd>{file.opposingParties.join("، ")}</dd></div>}
          </dl>
          {file.summary && <p className="fact-note">{file.summary}</p>}
          {file.privateNotes && <p className="fact-note private"><b>ملاحظات خاصة:</b> {file.privateNotes}</p>}
        </section>

        <section className="card">
          <header className="card-head"><h2>الجلسات</h2>{office && <button className="link-btn" onClick={() => setModal("hearing")}><CalendarPlus size={16} /> تسجيل جلسة</button>}</header>
          {file.hearings.length === 0 ? <Empty title="لا توجد جلسات مسجلة" /> : (
            <ul className="timeline">{file.hearings.map((hearing) => (
              <li key={hearing.id}>
                <div><b>{formatDateTime(hearing.startsAt)}</b>{hearing.purpose && <span>{hearing.purpose}</span>}{hearing.notes && <p>ما جرى: {hearing.notes}</p>}{hearing.decision && <p>القرار: {hearing.decision}</p>}</div>
                {office && <button className="icon-btn" aria-label="تعديل الجلسة" onClick={() => setEditingHearing(hearing)}><Pencil size={15} /></button>}
              </li>
            ))}</ul>
          )}
        </section>

        <section className="card">
          <header className="card-head"><h2><ClipboardPlus size={18} /> تحديثات القضية</h2></header>
          {file.updates.length === 0 ? <Empty title="لا توجد تحديثات" hint="سجّل ما جرى من زر «إضافة تحديث»." /> : (
            <ul className="timeline">{file.updates.map((item) => (
              <li key={item.id}><div><b>{updateKinds[item.kind]} · {formatDate(item.occurredAt)}</b><span>{item.createdBy.name}</span><p>{item.note}</p>{item.nextHearingAt && <p>الجلسة التالية: {formatDateTime(item.nextHearingAt)}</p>}</div></li>
            ))}</ul>
          )}
        </section>

        <section className="card">
          <header className="card-head">
            <h2>المستندات</h2>
            <button className="link-btn" onClick={() => fileInput.current?.click()}><Upload size={16} /> رفع مستند</button>
            <input type="file" hidden ref={fileInput} accept={DOCUMENT_ACCEPT} onChange={upload} />
          </header>
          {uploadError && <div className="notice notice-error">{uploadError}</div>}
          {file.documents.length === 0 ? <Empty title="لا توجد مستندات" /> : (
            <ul className="rows">{file.documents.map((document) => (
              <li key={document.id}>
                <span>{document.title}<small>{documentCategories[document.category]} · إصدار {document.version} · {document.pageCount} صفحة · {formatDate(document.createdAt)}</small></span>
                <button className="btn btn-ghost btn-sm" onClick={() => setViewing(document.id)}><Eye size={15} /> عرض</button>
              </li>
            ))}</ul>
          )}
        </section>

        <section className="card">
          <header className="card-head"><h2><Gavel size={18} /> الأحكام</h2><Link className="link-btn" href="/app/judgments">كل الأحكام</Link></header>
          {file.judgments.length === 0 ? <Empty title="لا توجد أحكام مسجلة" /> : (
            <ul className="rows">{file.judgments.map((judgment) => (
              <li key={judgment.id}><span>{judgment.title}<small>{formatDate(judgment.decidedAt)}{judgment.appealDeadline ? ` · موعد طعن ${formatDate(judgment.appealDeadline)}` : ""}</small></span></li>
            ))}</ul>
          )}
        </section>

        <section className="card">
          <header className="card-head"><h2><FileEdit size={18} /> المسودات</h2><Link className="link-btn" href="/app/documents?tab=drafts"><Plus size={15} /> إدارة المسودات</Link></header>
          {file.drafts.length === 0 ? <Empty title="لا توجد مسودات" /> : (
            <ul className="rows">{file.drafts.map((draft) => (
              <li key={draft.id}>
                <Link href={`/app/documents?tab=drafts&draft=${draft.id}`}>{draft.title}<small>{draftKinds[draft.kind]}{draft.generatedByAi ? " · من المساعد" : ""}</small></Link>
                <Pill tone={draft.status === "APPROVED" ? "good" : draft.status === "REJECTED" ? "bad" : "warn"}>{draftStatuses[draft.status]}</Pill>
              </li>
            ))}</ul>
          )}
        </section>

        <section className="card">
          <header className="card-head"><h2><CheckSquare size={18} /> المهام</h2><Link className="link-btn" href="/app/tasks">كل المهام</Link></header>
          {file.tasks.length === 0 ? <Empty title="لا توجد مهام" /> : (
            <ul className="rows">{file.tasks.map((task) => (
              <li key={task.id} className={task.completedAt ? "done" : ""}><span>{task.title}<small>{task.assignee.name}{task.dueAt ? ` · ${formatDate(task.dueAt)}` : ""}</small></span></li>
            ))}</ul>
          )}
        </section>

        <section className="card">
          <header className="card-head"><h2><MessageCircle size={18} /> الرسائل</h2><Link className="link-btn" href="/app/whatsapp">كل الرسائل</Link></header>
          {file.client.whatsappOptOutAt && <div className="notice notice-gold">ألغى العميل اشتراكه في رسائل واتساب.</div>}
          {file.messages.length === 0 ? <Empty title="لا توجد رسائل" /> : (
            <ul className="rows">{file.messages.map((message) => (
              <li key={message.id}><span>{message.body}<small>{message.direction === "INBOUND" ? "واردة" : messageStatuses[message.status]} · {formatDateTime(message.createdAt)}</small></span></li>
            ))}</ul>
          )}
        </section>

        {senior && (
          <section className="card">
            <header className="card-head"><h2><Receipt size={18} /> الأتعاب</h2><button className="link-btn" onClick={() => setModal("invoice")}><Plus size={15} /> فاتورة</button></header>
            <dl className="money-facts">
              <div><dt>الأتعاب المتفق عليها</dt><dd>{file.fees ? money(file.fees) : "—"}</dd></div>
              <div><dt>المفوتر</dt><dd>{money(billed)}</dd></div>
              <div><dt>المدفوع</dt><dd>{money(paid)}</dd></div>
              <div><dt>المستحق</dt><dd>{money(billed - paid)}</dd></div>
            </dl>
            <Link className="link-btn fact-link" href="/app/billing">كل الفواتير</Link>
          </section>
        )}

        <CaseCosts caseId={file.id} />

        <section className="card">
          <header className="card-head"><h2><History size={18} /> السجل الزمني</h2></header>
          {data.timeline.length === 0 ? <Empty title="لا توجد تعديلات مسجلة" /> : (
            <ul className="rows">{data.timeline.map((entry) => (
              <li key={entry.id}><span>{actionLabel(entry.action)}<small>{entry.user.name} · {formatDateTime(entry.createdAt)}</small></span></li>
            ))}</ul>
          )}
        </section>
      </div>

      {viewing && <DocumentViewer id={viewing} onClose={() => setViewing(null)} />}
      {modal === "update" && (
        <FormModal
          title="إضافة تحديث"
          fields={[
            { name: "kind", label: "نوع التحديث", type: "select", required: true, defaultValue: "ADJOURNMENT", options: Object.entries(updateKinds) },
            { name: "occurredAt", label: "التاريخ", type: "date", required: true, defaultValue: new Date().toISOString().slice(0, 10) },
            { name: "note", label: "ما جرى", type: "textarea", required: true, rows: 4 },
            { name: "nextHearingAt", label: "موعد الجلسة القادمة (إن تغيّر)", type: "datetime-local" },
            ...(senior ? [{ name: "status", label: "حالة القضية (إن تغيّرت)", type: "select", placeholder: "دون تغيير", options: Object.entries(caseStatuses) } as Field] : []),
          ]}
          onClose={() => setModal("")}
          onSubmit={async (values) => { await send("/api/cases/updates", "POST", { ...values, caseId: file.id }); await reload(); }}
        />
      )}
      {modal === "hearing" && (
        <FormModal title="تسجيل جلسة" fields={hearingFields()} onClose={() => setModal("")} onSubmit={async (values) => { await send("/api/hearings", "POST", { ...values, caseId: file.id }); await reload(); }} />
      )}
      {editingHearing && (
        <FormModal title="تعديل الجلسة" fields={hearingFields(editingHearing)} onClose={() => setEditingHearing(null)} onSubmit={async (values) => { await send(`/api/hearings?id=${editingHearing.id}`, "PATCH", values); await reload(); }} />
      )}
      {modal === "edit" && (
        <FormModal
          title="تعديل القضية"
          fields={[
            { name: "title", label: "عنوان القضية", required: true, defaultValue: file.title },
            { name: "status", label: "الحالة", type: "select", required: true, defaultValue: file.status, options: Object.entries(caseStatuses) },
            { name: "courtCity", label: "المدينة", defaultValue: file.courtCity ?? undefined },
            { name: "mojCourt", label: "موقع المحكمة (كما في الوزارة)", defaultValue: file.mojCourt ?? undefined },
            { name: "mojJurisdiction", label: "الاختصاص", defaultValue: file.mojJurisdiction ?? undefined },
            { name: "mojRegistry", label: "السجل", defaultValue: file.mojRegistry ?? undefined },
            { name: "mojNumber", label: "رقم القضية في الوزارة", dir: "ltr", defaultValue: file.mojNumber ?? undefined },
            { name: "mojYear", label: "السنة", type: "number", defaultValue: file.mojYear ? String(file.mojYear) : undefined },
            { name: "fees", label: "الأتعاب بالدينار", type: "number", defaultValue: file.fees ?? undefined },
            { name: "summary", label: "موجز القضية", type: "textarea", defaultValue: file.summary ?? undefined },
            { name: "privateNotes", label: "ملاحظات خاصة", type: "textarea", defaultValue: file.privateNotes ?? undefined },
          ]}
          onClose={() => setModal("")}
          onSubmit={async (values) => { await send(`/api/cases?id=${file.id}`, "PATCH", values); await reload(); }}
        />
      )}
      {modal === "invoice" && (
        <FormModal
          title="فاتورة جديدة"
          fields={[
            { name: "number", label: "رقم الفاتورة", required: true },
            { name: "amount", label: "المبلغ بالدينار", type: "number", required: true },
            { name: "issuedAt", label: "تاريخ الإصدار", type: "date", required: true, defaultValue: new Date().toISOString().slice(0, 10) },
            { name: "dueAt", label: "تاريخ الاستحقاق", type: "date" },
          ]}
          onClose={() => setModal("")}
          onSubmit={async (values) => { await send("/api/invoices", "POST", { ...values, caseId: file.id }); await reload(); }}
        />
      )}
      {modal === "moj" && (
        <Modal title="الاستعلام في وزارة العدل" onClose={() => { setModal(""); setCopied(""); }}>
          {file.mojNumber && file.mojYear ? (
            <dl className="money-facts moj-facts">
              <div><dt>موقع المحكمة</dt><dd>{file.mojCourt ?? "—"}</dd></div>
              <div><dt>الاختصاص</dt><dd>{file.mojJurisdiction ?? "—"}</dd></div>
              <div><dt>السجل</dt><dd>{file.mojRegistry ?? "—"}</dd></div>
              <div><dt>الرقم / السنة</dt><dd dir="ltr">{file.mojNumber}/{file.mojYear}</dd></div>
            </dl>
          ) : <p className="confirm-body">أدخل بيانات القضية كما تظهر في الوزارة من زر «تعديل» أولاً.</p>}
          <p className="form-note">افتح موقع الوزارة، ثم «الخدمات الإلكترونية» واختر الاستعلام، وأدخل هذه البيانات. لا يتصل النظام بالوزارة مباشرة.</p>
          <div className="form-actions">
            {file.mojNumber && file.mojYear && <button className="btn btn-ghost" onClick={async () => setCopied((await copyText([`موقع المحكمة: ${file.mojCourt ?? ""}`, `الاختصاص: ${file.mojJurisdiction ?? ""}`, `السجل: ${file.mojRegistry ?? ""}`, `رقم القضية: ${file.mojNumber}/${file.mojYear}`].join("\n"))) ? "done" : "failed")}><Copy size={15} /> {copied === "done" ? "نُسخت" : copied === "failed" ? "تعذّر النسخ" : "نسخ البيانات"}</button>}
            <a className="btn btn-gold" href="https://www.moj.gov.jo" target="_blank" rel="noreferrer"><ExternalLink size={15} /> فتح موقع الوزارة</a>
          </div>
        </Modal>
      )}
      {modal === "remove" && <Confirm title="حذف القضية" body={`ستنتقل القضية ${file.caseNumber} إلى سلة المحذوفات ويمكن استرجاعها من الإعدادات.`} action="حذف" danger onClose={() => setModal("")} onConfirm={async () => { await send(`/api/cases?id=${file.id}`, "DELETE"); router.replace("/app/cases"); }} />}
    </>
  );
}
