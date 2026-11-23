"use client";

import { BellRing, Bot, Check, ExternalLink, MessageCircle, Pencil, Plus, Send, X } from "lucide-react";
import { useState } from "react";
import { useUser } from "@/components/AppShell";
import { whatsappNumber } from "@/lib/text";
import { Confirm, Empty, formatDateTime, FormModal, Loader, messageStatuses, PageHead, Pill, send, Toast, useData } from "@/components/ui";

type Message = {
  id: string; body: string; status: string; direction: string; fromPhone: string | null; reminderKind: string | null; failure: string | null; deliveryStatus: string | null; scheduledFor: string | null; generatedByAi: boolean; createdAt: string; sentAt: string | null;
  client: { id: string; name: string; phone: string } | null; legalCase: { id: string; caseNumber: string } | null;
};

const tone = (status: string) => ({ DRAFT: "warn", APPROVED: "info", SENT: "good", CANCELLED: "neutral" })[status] ?? "neutral";
const whatsappLink = (message: Message) => `https://wa.me/${whatsappNumber(message.client?.phone ?? "")}?text=${encodeURIComponent(message.body)}`;

export default function WhatsappPage() {
  const user = useUser();
  const { data, error, reload } = useData<{ messages: Message[]; apiConfigured: boolean }>("/api/messages");
  const { data: clients } = useData<{ clients: { id: string; name: string; phone: string }[] }>("/api/clients");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null);
  const [cancelling, setCancelling] = useState<Message | null>(null);
  const [failure, setFailure] = useState("");
  const [toast, setToast] = useState("");
  const senior = user.role === "SENIOR_LAWYER";
  const office = senior || user.role === "SECRETARY";

  async function deliver(id: string) {
    setFailure("");
    try {
      const { result } = await send<{ result: { detail: string } }>(`/api/messages?id=${id}`, "PATCH", { action: "send" });
      setToast(result.detail);
      await reload();
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر الإرسال.");
    }
  }

  async function reminders() {
    setFailure("");
    try {
      const result = await send<{ created: number; sent: number }>("/api/whatsapp/reminders", "POST");
      setToast(`أُنشئت ${result.created} مسودة تذكير، وأُرسلت ${result.sent}`);
      await reload();
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر تجهيز التذكيرات.");
    }
  }

  async function act(id: string, action: string) {
    setFailure("");
    try {
      await send(`/api/messages?id=${id}`, "PATCH", { action });
      await reload();
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر التنفيذ.");
    }
  }

  return (
    <>
      <PageHead title="واتساب" subtitle={data?.apiConfigured ? "ربط واتساب مفعّل. تُعتمد كل رسالة قبل إرسالها، عدا القوالب التي فعّل المحامي إرسالها التلقائي." : "ربط واتساب غير مفعّل: تُعتمد الرسالة ثم تُرسل يدوياً."} action={<div className="head-actions">{office && <button className="btn btn-ghost" onClick={() => void reminders()}><BellRing size={16} /> تجهيز التذكيرات</button>}<button className="btn btn-gold" onClick={() => setCreating(true)}><Plus size={17} /> مسودة جديدة</button></div>} />
      {failure && <div className="notice notice-error">{failure}</div>}
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : data.messages.length === 0 ? <Empty title="لا توجد رسائل" icon={<MessageCircle size={28} />} /> : (
          <ul className="wa-list">{data.messages.map((message) => (
            <li key={message.id}>
              <div className="wa-head">
                <b>{message.client?.name ?? message.fromPhone ?? "رقم غير معروف"}{message.legalCase ? ` · ${message.legalCase.caseNumber}` : ""}</b>
                {message.reminderKind && <span className="muted"><BellRing size={14} /> تذكير</span>}
                {message.generatedByAi && <span className="muted"><Bot size={14} /> من المساعد</span>}
                {message.direction === "INBOUND" ? <Pill tone="info">واردة</Pill> : <Pill tone={tone(message.status)}>{messageStatuses[message.status]}</Pill>}
              </div>
              <p>{message.body}</p>
              {message.failure && <p className="wa-failure">{message.failure}</p>}
              {message.scheduledFor && message.status === "APPROVED" && <p className="muted">مجدولة: {formatDateTime(message.scheduledFor)}</p>}
              <div className="wa-foot">
                <small>{formatDateTime(message.sentAt ?? message.createdAt)}{message.deliveryStatus ? ` · ${message.deliveryStatus}` : ""}</small>
                <span className="spacer" />
                {message.status === "DRAFT" && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(message)}><Pencil size={15} /> تعديل</button>}
                {message.status === "DRAFT" && senior && <button className="btn btn-gold btn-sm" onClick={() => void act(message.id, "approve")}><Check size={15} /> اعتماد</button>}
                {message.status === "APPROVED" && office && (data.apiConfigured ? (
                  <button className="btn btn-gold btn-sm" onClick={() => void deliver(message.id)}><Send size={15} /> إرسال</button>
                ) : <>
                  <a className="btn btn-outline btn-sm" href={whatsappLink(message)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> فتح في واتساب</a>
                  <button className="btn btn-gold btn-sm" onClick={() => void act(message.id, "markSent")}><Send size={15} /> تأكيد الإرسال</button>
                </>)}
                {message.direction === "OUTBOUND" && (message.status === "DRAFT" || message.status === "APPROVED") && <button className="btn btn-ghost btn-sm" onClick={() => setCancelling(message)}><X size={15} /> إلغاء</button>}
              </div>
            </li>
          ))}</ul>
        )}
      </section>
      {creating && (
        <FormModal
          title="مسودة واتساب"
          fields={[
            { name: "clientId", label: "العميل", type: "select", required: true, wide: true, options: clients?.clients.map((client) => [client.id, `${client.name} — ${client.phone}`]) },
            { name: "body", label: "نص الرسالة", type: "textarea", required: true, rows: 5 },
          ]}
          note="تُحفظ كمسودة بانتظار اعتماد المحامي صاحب المكتب."
          onClose={() => setCreating(false)}
          onSubmit={async (values) => { await send("/api/messages", "POST", values); await reload(); }}
        />
      )}
      {editing && (
        <FormModal
          title="تعديل الرسالة"
          fields={[{ name: "body", label: "نص الرسالة", type: "textarea", required: true, rows: 5, defaultValue: editing.body }]}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => { await send(`/api/messages?id=${editing.id}`, "PATCH", values); await reload(); }}
        />
      )}
      {cancelling && <Confirm title="إلغاء الرسالة" body={`إلغاء الرسالة إلى ${cancelling.client?.name ?? ""}؟`} action="إلغاء الرسالة" danger onClose={() => setCancelling(null)} onConfirm={async () => { await send(`/api/messages?id=${cancelling.id}`, "PATCH", { action: "cancel" }); await reload(); }} />}
      {toast && <Toast text={toast} onDone={() => setToast("")} />}
    </>
  );
}
