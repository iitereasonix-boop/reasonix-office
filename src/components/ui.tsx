"use client";

import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileText, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || "تعذر تنفيذ الطلب.", response.status);
  return body as T;
}

/**
 * Copies text exactly as given and reports whether it worked. The Clipboard API is refused
 * on plain http and when permission is denied, so a hidden textarea is the fallback.
 */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

export const send = <T = unknown,>(url: string, method: string, body?: unknown) =>
  request<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });

/** Loads one endpoint and exposes its state; call reload after any change. */
export function useData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!url) return;
    try {
      setData(await request<T>(url));
      setError("");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر تحميل البيانات.");
    }
  }, [url]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

export const roleLabels: Record<string, string> = {
  SENIOR_LAWYER: "المحامي صاحب المكتب", TRAINEE_LAWYER: "محامٍ متدرب", SECRETARY: "سكرتير", CLIENT: "عميل",
};
export const caseTypes: Record<string, string> = {
  CRIMINAL: "جزائي", CIVIL: "مدني", COMMERCIAL: "تجاري", PERSONAL_STATUS: "أحوال شخصية", ADMINISTRATIVE: "إداري",
};
export const courts: Record<string, string> = {
  FIRST_INSTANCE: "بداية", MAGISTRATES: "صلح", APPEAL: "استئناف", CASSATION: "تمييز",
};
export const caseStatuses: Record<string, string> = {
  OPEN: "جديدة", IN_PROGRESS: "نشطة", ON_HOLD: "معلقة", CLOSED: "مغلقة",
};
export const draftKinds: Record<string, string> = {
  MEMO: "مذكرة", LETTER: "رسالة", NOTICE: "إخطار", REPORT: "تقرير", OTHER: "أخرى",
};
export const draftStatuses: Record<string, string> = { DRAFT: "بانتظار المراجعة", APPROVED: "معتمدة", REJECTED: "مرفوضة" };
export const messageStatuses: Record<string, string> = { DRAFT: "مسودة", APPROVED: "معتمدة", SENT: "مُرسلة", CANCELLED: "ملغاة" };
export const priorities: Record<string, string> = { LOW: "منخفضة", NORMAL: "عادية", HIGH: "عالية" };
export const documentCategories: Record<string, string> = {
  PLEADING: "لوائح ومذكرات", EVIDENCE: "بينات", COURT_ORDER: "قرارات المحكمة", CONTRACT: "عقود", POWER_OF_ATTORNEY: "وكالات", CORRESPONDENCE: "مراسلات", OTHER: "أخرى",
};
export const updateKinds: Record<string, string> = { ADJOURNMENT: "تأجيل", EXPERT_REQUEST: "طلب خبرة", NOTIFICATION: "تبليغ", DECISION: "قرار", OTHER: "أخرى" };
export const DOCUMENT_ACCEPT = "application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp";
export const money = (value: number | string) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value))} د.أ`;

const inAmman = { timeZone: "Asia/Amman" } as const;
export const formatDate = (value: string | Date) =>
  new Intl.DateTimeFormat("en-CA", inAmman).format(new Date(value)).replaceAll("-", "/");
export const formatTime = (value: string | Date) =>
  new Intl.DateTimeFormat("ar-JO", { ...inAmman, hour: "2-digit", minute: "2-digit", numberingSystem: "latn" }).format(new Date(value));
export const formatDateTime = (value: string | Date) => `${formatDate(value)} · ${formatTime(value)}`;
export const dayKey = (value: string | Date) => new Intl.DateTimeFormat("en-CA", inAmman).format(new Date(value));

export function timeAgo(value: string | Date) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return formatDate(value);
}

export function Pill({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function PageHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

export function Empty({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return <div className="empty">{icon}<b>{title}</b>{hint && <p>{hint}</p>}</div>;
}

export function Loader({ error, retry }: { error?: string; retry?: () => void }) {
  if (error) return <div className="notice notice-error"><AlertCircle size={17} /><span>{error}</span>{retry && <button className="link-btn" onClick={retry}>إعادة المحاولة</button>}</div>;
  return <div className="empty"><span className="spinner" /></div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-btn" aria-label="إغلاق" onClick={onClose}><X size={19} /></button></header>
        {children}
      </section>
    </div>
  );
}

export type Field = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "tel" | "date" | "datetime-local" | "textarea" | "select";
  required?: boolean;
  options?: [string, string][];
  placeholder?: string;
  wide?: boolean;
  defaultValue?: string;
  dir?: "ltr" | "rtl";
  rows?: number;
};

/** Empty inputs become undefined, and date inputs become ISO strings in Amman time. */
function collect(form: HTMLFormElement, fields: Field[]) {
  const data = new FormData(form);
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = String(data.get(field.name) ?? "").trim();
    if (!raw) continue;
    if (field.type === "number") values[field.name] = Number(raw);
    else if (field.type === "date") values[field.name] = new Date(`${raw}T09:00:00+03:00`).toISOString();
    else if (field.type === "datetime-local") values[field.name] = new Date(`${raw}:00+03:00`).toISOString();
    else values[field.name] = raw;
  }
  return values;
}

export function FormFields({ fields }: { fields: Field[] }) {
  return (
    <>
      {fields.map((field) => (
        <label key={field.name} className={field.wide || field.type === "textarea" ? "wide" : ""}>
          <span>{field.label}{field.required ? " *" : ""}</span>
          {field.type === "textarea" ? (
            <textarea name={field.name} required={field.required} rows={field.rows ?? 3} placeholder={field.placeholder} defaultValue={field.defaultValue} />
          ) : field.type === "select" ? (
            // Options often arrive after the modal opens; remounting applies defaultValue to them.
            <select key={field.options?.length ?? 0} name={field.name} required={field.required} defaultValue={field.defaultValue ?? ""}>
              {!field.required || !field.defaultValue ? <option value="">{field.placeholder ?? "اختر..."}</option> : null}
              {field.options?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          ) : (
            <input name={field.name} type={field.type ?? "text"} required={field.required} placeholder={field.placeholder} defaultValue={field.defaultValue} dir={field.dir} min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? "any" : undefined} />
          )}
        </label>
      ))}
    </>
  );
}

export function FormModal({ title, fields, onSubmit, onClose, note, submitLabel = "حفظ" }: {
  title: string; fields: Field[]; onSubmit: (values: Record<string, unknown>) => Promise<unknown>; onClose: () => void; note?: string; submitLabel?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(collect(event.currentTarget, fields));
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر الحفظ.");
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <FormFields fields={fields} />
        {note && <p className="form-note wide">{note}</p>}
        {error && <div className="notice notice-error wide"><AlertCircle size={16} />{error}</div>}
        <div className="form-actions wide">
          <button type="button" className="btn btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold" disabled={busy}>{busy ? "جارٍ الحفظ..." : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export function Confirm({ title, body, action, danger, onConfirm, onClose }: {
  title: string; body: string; action: string; danger?: boolean; onConfirm: () => Promise<unknown>; onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر التنفيذ.");
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <p className="confirm-body">{body}</p>
      {error && <div className="notice notice-error"><AlertCircle size={16} />{error}</div>}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
        <button className={`btn ${danger ? "btn-danger" : "btn-gold"}`} disabled={busy} onClick={run}>{action}</button>
      </div>
    </Modal>
  );
}

type Viewed = {
  id: string; title: string; fileName: string; mimeType: string; pageCount: number; extraction: string;
  legalCase: { caseNumber: string }; pages: { page: number; text: string }[];
};

/** Opens at the cited page so a lawyer can check a source in one click. */
export function DocumentViewer({ id, page, onClose }: { id: string; page?: number; onClose: () => void }) {
  const { data, error } = useData<{ document: Viewed }>(`/api/documents?id=${id}`);
  const [current, setCurrent] = useState(page ?? 1);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => body.current?.scrollTo({ top: 0 }), [current]);
  const document = data?.document;
  const shown = document?.pages.find((item) => item.page === current);
  return (
    <Modal title={document?.title ?? "المستند"} onClose={onClose} wide>
      {!document ? <Loader error={error} /> : (
        <>
          <div className="viewer-bar">
            <span><FileText size={15} /> القضية {document.legalCase.caseNumber}</span>
            <span className="viewer-nav">
              <button className="icon-btn" aria-label="الصفحة السابقة" disabled={current <= 1} onClick={() => setCurrent(current - 1)}><ChevronRight size={17} /></button>
              <b>صفحة {current} من {document.pageCount || 1}</b>
              <button className="icon-btn" aria-label="الصفحة التالية" disabled={current >= document.pageCount} onClick={() => setCurrent(current + 1)}><ChevronLeft size={17} /></button>
            </span>
            <a className="link-btn" href={`/api/documents/file?id=${document.id}`} target="_blank" rel="noreferrer">الملف الأصلي <ExternalLink size={14} /></a>
          </div>
          <div className="viewer-page" ref={body}>
            {shown ? shown.text : "لا يوجد نص مستخرج لهذا المستند. افتح الملف الأصلي للاطلاع عليه."}
          </div>
        </>
      )}
    </Modal>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 3200);
    return () => clearTimeout(timer);
  }, [onDone]);
  return <div className="toast" role="status"><CheckCircle2 size={17} />{text}</div>;
}
