"use client";

import { Bot, Check, Copy, Eye, FileEdit, FilePlus2, FolderOpen, History, LayoutTemplate, Pencil, Plus, Printer, RotateCcw, Save, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useUser } from "@/components/AppShell";
import {
  Confirm, copyText, documentCategories, DOCUMENT_ACCEPT, DocumentViewer, draftKinds, draftStatuses, Empty, formatDate, FormModal, Loader, Modal, PageHead, Pill, request, send, Toast, useData,
} from "@/components/ui";

type Doc = { id: string; title: string; fileName: string; size: number; pageCount: number; extraction: string; category: string; version: number; rootId: string | null; createdAt: string; legalCase: { id: string; caseNumber: string; title: string }; uploadedBy: { name: string } };
type Draft = {
  id: string; title: string; kind: string; body: string; status: string; generatedByAi: boolean; createdAt: string; createdById: string;
  legalCase: { id: string; caseNumber: string; title: string }; createdBy: { name: string }; reviewedBy: { name: string } | null;
  sources: { id: string; label: string; detail?: string; documentId?: string; page?: number }[] | null;
};
type CaseOption = { id: string; caseNumber: string; title: string };

const draftTone = (status: string) => (status === "APPROVED" ? "good" : status === "REJECTED" ? "bad" : "warn");

function Documents() {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") === "drafts" ? "drafts" : params.get("tab") === "templates" ? "templates" : "files");
  const { data: cases } = useData<{ cases: CaseOption[] }>("/api/cases");
  return (
    <>
      <PageHead title="المستندات" subtitle="ملفات القضايا والمسودات القانونية." />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "files"} className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}><FolderOpen size={16} /> الملفات</button>
        <button role="tab" aria-selected={tab === "drafts"} className={tab === "drafts" ? "active" : ""} onClick={() => setTab("drafts")}><FileEdit size={16} /> المسودات القانونية</button>
        <button role="tab" aria-selected={tab === "templates"} className={tab === "templates" ? "active" : ""} onClick={() => setTab("templates")}><LayoutTemplate size={16} /> القوالب</button>
      </div>
      {tab === "files" ? <Files cases={cases?.cases ?? []} /> : tab === "drafts" ? <Drafts cases={cases?.cases ?? []} openId={params.get("draft")} /> : <Templates cases={cases?.cases ?? []} onDraft={() => setTab("drafts")} />}
    </>
  );
}

function Files({ cases }: { cases: CaseOption[] }) {
  const user = useUser();
  const params = useSearchParams();
  const [caseFilter, setCaseFilter] = useState("");
  const [category, setCategory] = useState("");
  const [versionOf, setVersionOf] = useState<Doc | null>(null);
  const [history, setHistory] = useState<Doc | null>(null);
  const { data, error, reload } = useData<{ documents: Doc[] }>(`/api/documents${caseFilter ? `?caseId=${caseFilter}` : ""}`);
  const [viewing, setViewing] = useState<{ id: string; page?: number } | null>(() => {
    const id = params.get("view");
    return id ? { id, page: Number(params.get("page")) || 1 } : null;
  });
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<Doc | null>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      await request("/api/documents", { method: "POST", body: new FormData(event.currentTarget) });
      setUploading(false);
      setVersionOf(null);
      await reload();
    } catch (issue) {
      setFormError(issue instanceof Error ? issue.message : "تعذر رفع الملف.");
    } finally {
      setBusy(false);
    }
  }

  // Each document shows once, at its newest version; older ones stay reachable from history.
  const rootOf = (document: Doc) => document.rootId ?? document.id;
  const latest = data?.documents.filter((document) => document.version === Math.max(...data.documents.filter((other) => rootOf(other) === rootOf(document)).map((other) => other.version))) ?? [];
  const shown = latest.filter((document) => !category || document.category === category);

  return (
    <>
      <div className="filters">
        <select value={caseFilter} onChange={(event) => setCaseFilter(event.target.value)} aria-label="القضية">
          <option value="">كل القضايا</option>
          {cases.map((item) => <option key={item.id} value={item.id}>{item.caseNumber} — {item.title}</option>)}
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="التصنيف">
          <option value="">كل التصنيفات</option>
          {Object.entries(documentCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <button className="btn btn-gold" onClick={() => setUploading(true)}><Upload size={17} /> رفع مستند</button>
      </div>
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : shown.length === 0 ? <Empty title="لا توجد مستندات" hint="ارفع PDF أو Word أو صورة ليتمكن المساعد من قراءته." /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>المستند</th><th>القضية</th><th>التصنيف</th><th>الإصدار</th><th>الصفحات</th><th>رُفع بواسطة</th><th>التاريخ</th><th aria-label="إجراءات" /></tr></thead>
            <tbody>{shown.map((document) => (
              <tr key={document.id}>
                <td><b>{document.title}</b>{document.extraction === "NO_TEXT" && <small>تعذر استخراج النص، والمساعد لن يقرأه</small>}</td>
                <td><Link href={`/app/cases/${document.legalCase.id}`}>{document.legalCase.caseNumber}</Link></td>
                <td>{documentCategories[document.category]}</td>
                <td>{document.version}</td>
                <td>{document.pageCount}</td>
                <td>{document.uploadedBy.name}</td>
                <td>{formatDate(document.createdAt)}</td>
                <td className="row-actions">
                  <button className="icon-btn" aria-label={`عرض ${document.title}`} onClick={() => setViewing({ id: document.id })}><Eye size={16} /></button>
                  <button className="icon-btn" aria-label={`إصدار جديد من ${document.title}`} onClick={() => { setVersionOf(document); setUploading(true); }}><FilePlus2 size={16} /></button>
                  {document.version > 1 && <button className="icon-btn" aria-label={`إصدارات ${document.title}`} onClick={() => setHistory(document)}><History size={16} /></button>}
                  {user.role !== "TRAINEE_LAWYER" && <button className="icon-btn" aria-label={`حذف ${document.title}`} onClick={() => setRemoving(document)}><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {viewing && <DocumentViewer id={viewing.id} page={viewing.page} onClose={() => setViewing(null)} />}
      {uploading && (
        <Modal title={versionOf ? `إصدار جديد من «${versionOf.title}»` : "رفع مستند"} onClose={() => { setUploading(false); setVersionOf(null); }}>
          <form className="form-grid" onSubmit={upload}>
            {versionOf ? <>
              <input type="hidden" name="caseId" value={versionOf.legalCase.id} />
              <input type="hidden" name="versionOf" value={versionOf.id} />
            </> : <>
              <label className="wide"><span>القضية *</span><select name="caseId" required defaultValue={caseFilter}><option value="">اختر...</option>{cases.map((item) => <option key={item.id} value={item.id}>{item.caseNumber} — {item.title}</option>)}</select></label>
              <label><span>عنوان المستند</span><input name="title" placeholder="اسم الملف إن تُرك فارغاً" /></label>
              <label><span>التصنيف</span><select name="category" defaultValue="OTHER">{Object.entries(documentCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            </>}
            <label className="wide"><span>الملف * (PDF أو Word أو صورة أو نص، حتى 15 ميغابايت)</span><input name="file" type="file" required accept={DOCUMENT_ACCEPT} /></label>
            {formError && <div className="notice notice-error wide">{formError}</div>}
            <div className="form-actions wide"><button className="btn btn-gold" disabled={busy}>{busy ? "جارٍ الرفع والقراءة..." : "رفع"}</button></div>
          </form>
        </Modal>
      )}
      {history && (
        <Modal title={`إصدارات «${history.title}»`} onClose={() => setHistory(null)}>
          <ul className="rows">{data?.documents.filter((document) => rootOf(document) === rootOf(history)).sort((a, b) => b.version - a.version).map((document) => (
            <li key={document.id}>
              <span>الإصدار {document.version}<small>{document.fileName} · {document.uploadedBy.name} · {formatDate(document.createdAt)}</small></span>
              <button className="btn btn-ghost btn-sm" onClick={() => { setHistory(null); setViewing({ id: document.id }); }}><Eye size={15} /> عرض</button>
            </li>
          ))}</ul>
        </Modal>
      )}
      {removing && <Confirm title="حذف المستند" body={`حذف «${removing.title}» من ملف القضية؟`} action="حذف" danger onClose={() => setRemoving(null)} onConfirm={async () => { await send(`/api/documents?id=${removing.id}`, "DELETE"); await reload(); }} />}
    </>
  );
}

function Drafts({ cases, openId }: { cases: CaseOption[]; openId: string | null }) {
  const { data, error, reload } = useData<{ drafts: Draft[] }>("/api/drafts");
  const [creating, setCreating] = useState(false);
  const [openDraft, setOpenDraft] = useState<string | null>(openId);
  const current = data?.drafts.find((draft) => draft.id === openDraft);
  return (
    <>
      <div className="filters filters-end"><button className="btn btn-gold" onClick={() => setCreating(true)}><Plus size={17} /> مسودة جديدة</button></div>
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : data.drafts.length === 0 ? <Empty title="لا توجد مسودات" hint="اطلب من المساعد تجهيز مذكرة، أو أنشئ مسودة بنفسك." /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>المسودة</th><th>القضية</th><th>النوع</th><th>الكاتب</th><th>الحالة</th></tr></thead>
            <tbody>{data.drafts.map((draft) => (
              <tr key={draft.id} className="row-link" onClick={() => setOpenDraft(draft.id)}>
                <td><button className="plain-btn"><b>{draft.title}</b></button></td>
                <td>{draft.legalCase.caseNumber}</td>
                <td>{draftKinds[draft.kind]}</td>
                <td>{draft.generatedByAi ? <span className="muted"><Bot size={14} /> المساعد لـ {draft.createdBy.name}</span> : draft.createdBy.name}</td>
                <td><Pill tone={draftTone(draft.status)}>{draftStatuses[draft.status]}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {current && <DraftEditor key={current.id + current.status} draft={current} onClose={() => setOpenDraft(null)} reload={reload} />}
      {creating && (
        <FormModal
          title="مسودة جديدة"
          fields={[
            { name: "caseId", label: "القضية", type: "select", required: true, wide: true, options: cases.map((item) => [item.id, `${item.caseNumber} — ${item.title}`]) },
            { name: "title", label: "العنوان", required: true },
            { name: "kind", label: "النوع", type: "select", required: true, defaultValue: "MEMO", options: Object.entries(draftKinds) },
            { name: "body", label: "النص", type: "textarea", required: true, rows: 8 },
          ]}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => { await send("/api/drafts", "POST", values); await reload(); }}
        />
      )}
    </>
  );
}

function Templates({ cases, onDraft }: { cases: CaseOption[]; onDraft: () => void }) {
  const user = useUser();
  const { data, error, reload } = useData<{ templates: { id: string; name: string; kind: string; body: string }[] }>("/api/templates");
  const [using, setUsing] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; kind: string; body: string } | "new" | null>(null);
  const senior = user.role === "SENIOR_LAWYER";
  const current = editing && editing !== "new" ? editing : null;
  return (
    <>
      <div className="filters filters-end">{senior && <button className="btn btn-gold" onClick={() => setEditing("new")}><Plus size={17} /> قالب جديد</button>}</div>
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : data.templates.length === 0 ? <Empty title="لا توجد قوالب" /> : (
          <ul className="rows">{data.templates.map((template) => (
            <li key={template.id}>
              <span>{template.name}<small>{draftKinds[template.kind]}</small></span>
              <span className="row-actions">
                {senior && <button className="icon-btn" aria-label={`تعديل ${template.name}`} onClick={() => setEditing(template)}><Pencil size={15} /></button>}
                <button className="btn btn-outline btn-sm" onClick={() => setUsing(template.id)}><FilePlus2 size={15} /> إنشاء مسودة</button>
              </span>
            </li>
          ))}</ul>
        )}
      </section>
      <p className="form-note">الحقول المتاحة: {"{{client_name}} {{lawyer_name}} {{case_number}} {{case_title}} {{court}} {{opposing_parties}} {{today}}"}</p>
      {using && (
        <FormModal
          title="تعبئة القالب من بيانات القضية"
          fields={[{ name: "caseId", label: "القضية", type: "select", required: true, wide: true, options: cases.map((item) => [item.id, `${item.caseNumber} — ${item.title}`]) }]}
          note="تُنشأ مسودة بانتظار المراجعة والاعتماد."
          submitLabel="إنشاء"
          onClose={() => setUsing(null)}
          onSubmit={async (values) => { await send("/api/templates?fill=1", "POST", { ...values, templateId: using }); onDraft(); }}
        />
      )}
      {editing && (
        <FormModal
          title={current ? "تعديل القالب" : "قالب جديد"}
          fields={[
            { name: "name", label: "اسم القالب", required: true, defaultValue: current?.name },
            { name: "kind", label: "النوع", type: "select", required: true, defaultValue: current?.kind ?? "MEMO", options: Object.entries(draftKinds) },
            { name: "body", label: "النص", type: "textarea", required: true, rows: 10, defaultValue: current?.body },
          ]}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => { await (current ? send(`/api/templates?id=${current.id}`, "PATCH", values) : send("/api/templates", "POST", values)); await reload(); }}
        />
      )}
    </>
  );
}

function DraftEditor({ draft, onClose, reload }: { draft: Draft; onClose: () => void; reload: () => Promise<void> }) {
  const user = useUser();
  const senior = user.role === "SENIOR_LAWYER";
  const [body, setBody] = useState(draft.body);
  const [title, setTitle] = useState(draft.title);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewing, setViewing] = useState<{ id: string; page?: number } | null>(null);
  const editable = draft.status === "DRAFT" && (senior || draft.createdById === user.id);
  const dirty = body !== draft.body || title !== draft.title;

  useEffect(() => setError(""), [body, title]);

  async function act(payload: object, message: string) {
    setError("");
    try {
      await send(`/api/drafts?id=${draft.id}`, "PATCH", payload);
      setToast(message);
      await reload();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر الحفظ.");
    }
  }

  function print() {
    const frame = window.open("", "_blank");
    if (!frame) return;
    frame.document.title = title;
    const page = frame.document.createElement("pre");
    page.textContent = body;
    page.style.cssText = "font:16px/2 Tahoma,sans-serif;white-space:pre-wrap;direction:rtl;padding:40px";
    frame.document.body.append(page);
    frame.print();
  }

  return (
    <Modal title="مراجعة المسودة" onClose={onClose} wide>
      <div className="draft-meta">
        <Pill tone={draftTone(draft.status)}>{draftStatuses[draft.status]}</Pill>
        <span>القضية {draft.legalCase.caseNumber}</span>
        {draft.generatedByAi && <span className="muted"><Bot size={14} /> جهّزها المساعد</span>}
        {draft.reviewedBy && <span>راجعها {draft.reviewedBy.name}</span>}
      </div>
      {draft.generatedByAi && draft.status === "DRAFT" && <div className="notice notice-gold">هذا نص أولي من المساعد. راجع الوقائع والأسانيد القانونية قبل الاعتماد.</div>}
      <input className="draft-title" value={title} disabled={!editable} onChange={(event) => setTitle(event.target.value)} aria-label="عنوان المسودة" />
      <textarea className="draft-body" value={body} disabled={!editable} onChange={(event) => setBody(event.target.value)} aria-label="نص المسودة" rows={14} />
      {!!draft.sources?.length && (
        <div className="draft-sources"><b>المصادر:</b>{draft.sources.map((source) => (
          source.documentId
            ? <button key={source.id} className="link-btn" onClick={() => setViewing({ id: source.documentId as string, page: source.page })}>{source.label} {source.detail}</button>
            : <span key={source.id}>{source.label}</span>
        ))}</div>
      )}
      {error && <div className="notice notice-error">{error}</div>}
      <div className="draft-actions">
        <button className="btn btn-ghost btn-sm" onClick={async () => setToast((await copyText(body)) ? "نُسخ النص" : "تعذّر النسخ. حدّد النص وانسخه يدوياً.")}><Copy size={15} /> نسخ</button>
        <button className="btn btn-ghost btn-sm" onClick={print}><Printer size={15} /> طباعة</button>
        {draft.status !== "APPROVED" && (senior || draft.createdById === user.id) && <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> حذف</button>}
        <span className="spacer" />
        {editable && <button className="btn btn-ghost btn-sm" disabled={!dirty} onClick={() => void act({ title, body }, "حُفظت التعديلات")}><Save size={15} /> حفظ</button>}
        {senior && draft.status === "DRAFT" && <>
          <button className="btn btn-danger btn-sm" onClick={() => void act({ action: "reject" }, "رُفضت المسودة")}><X size={15} /> رفض</button>
          <button className="btn btn-gold btn-sm" disabled={dirty} title={dirty ? "احفظ التعديلات أولاً" : undefined} onClick={() => void act({ action: "approve" }, "اعتُمدت المسودة")}><Check size={15} /> اعتماد</button>
        </>}
        {senior && draft.status !== "DRAFT" && <button className="btn btn-ghost btn-sm" onClick={() => void act({ action: "reopen" }, "أُعيد فتح المسودة")}><RotateCcw size={15} /> إعادة فتح</button>}
      </div>
      {toast && <Toast text={toast} onDone={() => setToast("")} />}
      {viewing && <DocumentViewer id={viewing.id} page={viewing.page} onClose={() => setViewing(null)} />}
      {confirmDelete && <Confirm title="حذف المسودة" body="حذف هذه المسودة؟" action="حذف" danger onClose={() => setConfirmDelete(false)} onConfirm={async () => { await send(`/api/drafts?id=${draft.id}`, "DELETE"); await reload(); onClose(); }} />}
    </Modal>
  );
}

export default function DocumentsPage() {
  return <Suspense><Documents /></Suspense>;
}
