"use client";

import { CalendarDays, CheckCircle2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Modal, send, FormFields, type Field } from "@/components/ui";
import { services } from "@/lib/office";

const fields: Field[] = [
  { name: "name", label: "الاسم الكامل", required: true },
  { name: "phone", label: "رقم الهاتف", type: "tel", required: true, dir: "ltr", placeholder: "+962 7X XXX XXXX" },
  { name: "email", label: "البريد الإلكتروني", type: "email", dir: "ltr" },
  { name: "topic", label: "نوع الاستشارة", type: "select", required: true, options: services.map(({ title }) => [title, title]) },
  { name: "preferredAt", label: "الموعد المفضل", type: "datetime-local", wide: true },
  { name: "message", label: "نبذة عن موضوعك", type: "textarea", required: true, rows: 4 },
];

export function BookingButton({ className, children, topic }: { className: string; children: ReactNode; topic?: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const preferred = String(data.get("preferredAt") || "");
    try {
      await send("/api/consultations", "POST", {
        ...Object.fromEntries(data.entries()),
        preferredAt: preferred ? new Date(`${preferred}:00+03:00`).toISOString() : "",
      });
      setSent(true);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر إرسال الطلب.");
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setOpen(false);
    setSent(false);
    setError("");
  };

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open && (
        <Modal title="احجز استشارة" onClose={close}>
          {sent ? (
            <div className="booking-done"><CheckCircle2 size={38} /><b>وصل طلبك</b><p>سيتواصل معك فريق المكتب لتأكيد الموعد. طلبك لا يعني نشوء علاقة توكيل قبل الاتفاق مع المكتب.</p><button className="btn btn-gold" onClick={close}>إغلاق</button></div>
          ) : (
            <form className="form-grid" onSubmit={submit}>
              <FormFields fields={topic ? fields.map((field) => field.name === "topic" ? { ...field, defaultValue: topic } : field) : fields} />
              <input className="honeypot" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
              {error && <div className="notice notice-error wide">{error}</div>}
              <div className="form-actions wide"><button className="btn btn-gold" disabled={busy}><CalendarDays size={17} />{busy ? "جارٍ الإرسال..." : "إرسال الطلب"}</button></div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
