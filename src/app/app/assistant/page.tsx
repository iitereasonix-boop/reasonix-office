"use client";

import {
  AlertTriangle, BarChart3, Building2, CalendarDays, CheckCheck, Eye, FileEdit, FileText, Folder, Hash, History, Lightbulb, ListChecks, Paperclip, Plus, Scale, Send, Trash2, UserRound, Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { UserAvatar, useUser } from "@/components/AppShell";
import Image from "next/image";
import { caseStatuses, caseTypes, courts, DOCUMENT_ACCEPT, DocumentViewer, formatDate, Modal, Pill, request, send, useData } from "@/components/ui";

type Source = { id: string; kind: string; label: string; detail?: string; documentId?: string; page?: number; href?: string };
type DraftRef = { id: string; title: string; href: string };
type Message = { key: string; role: "USER" | "ASSISTANT"; content: string; sources?: Source[]; drafts?: DraftRef[]; warnings?: string[]; status?: string; error?: boolean; at: string; pending?: boolean };
type CaseOption = { id: string; caseNumber: string; title: string };
type CaseFile = {
  id: string; caseNumber: string; title: string; type: string; court: string; courtCity: string | null; status: string;
  client: { name: string };
  hearings: { startsAt: string; decision: string | null }[];
  documents: { id: string; title: string; pageCount: number }[];
};
type ConversationRow = { id: string; title: string; updatedAt: string; legalCase: { id: string; caseNumber: string } | null };

const clock = (value: string) => new Intl.DateTimeFormat("ar-JO", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit", numberingSystem: "latn" }).format(new Date(value));

/** Renders the small markdown subset the assistant uses, with citations as numbered chips. */
function RichText({ text, sources, onCite }: { text: string; sources: Source[]; onCite: (source: Source) => void }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*|\[S\d+\])/g).map((part, index) => {
      const cited = part.match(/^\[(S\d+)\]$/);
      if (cited) {
        const source = sources.find((item) => item.id === cited[1]);
        if (!source) return null;
        return <button key={index} className="cite" title={`${source.label}${source.detail ? ` — ${source.detail}` : ""}`} onClick={() => onCite(source)}>{sources.indexOf(source) + 1}</button>;
      }
      return part.startsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part;
    });
  return (
    <div className="rich">
      {text.split("\n").filter((line) => line.trim()).map((line, index) => {
        const bullet = line.match(/^\s*[-•]\s+(.*)/);
        return bullet ? <p key={index} className="rich-bullet">{inline(bullet[1])}</p> : <p key={index}>{inline(line)}</p>;
      })}
    </div>
  );
}

function Assistant() {
  const user = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [caseId, setCaseId] = useState(params.get("case") ?? "");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ id: string; page?: number } | null>(null);
  const [history, setHistory] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const { data: caseList } = useData<{ cases: CaseOption[] }>("/api/cases");
  const { data: caseData, reload: reloadCase } = useData<{ case: CaseFile }>(caseId ? `/api/cases?id=${caseId}` : null);
  const { data: conversations, reload: reloadConversations } = useData<{ conversations: ConversationRow[] }>("/api/assistant/conversations");
  const file = caseId && caseData?.case.id === caseId ? caseData.case : null;

  // The panel beside the chat always shows a case, as soon as one is available.
  useEffect(() => {
    if (!caseId && caseList?.cases[0]) setCaseId(caseList.cases[0].id);
  }, [caseId, caseList]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  const patchLast = useCallback((patch: (message: Message) => Message) => {
    setMessages((current) => current.map((message, index) => (index === current.length - 1 ? patch(message) : message)));
  }, []);

  const ask = useCallback(async (question: string) => {
    if (!question.trim() || busy) return;
    const now = new Date().toISOString();
    setBusy(true);
    setInput("");
    setMessages((current) => [
      ...current,
      { key: `u-${now}`, role: "USER", content: question, at: now },
      { key: `a-${now}`, role: "ASSISTANT", content: "", at: now, pending: true, status: "يفكر…" },
    ]);
    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, conversationId, caseId: caseId || undefined }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "تعذر الوصول إلى المساعد.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const chunk of events) {
          if (!chunk.startsWith("data: ")) continue;
          const event = JSON.parse(chunk.slice(6));
          if (event.type === "conversation") setConversationId(event.id);
          if (event.type === "status") patchLast((message) => ({ ...message, status: event.text }));
          if (event.type === "delta") patchLast((message) => ({ ...message, content: message.content + event.text, status: undefined }));
          if (event.type === "replace") patchLast((message) => ({ ...message, content: event.text }));
          if (event.type === "done") patchLast((message) => ({ ...message, content: event.text, sources: event.sources, drafts: event.drafts, warnings: event.warnings, pending: false, status: undefined }));
          if (event.type === "error") patchLast((message) => ({ ...message, content: event.text, error: true, pending: false, status: undefined }));
        }
      }
      void reloadConversations();
    } catch (issue) {
      patchLast((message) => ({ ...message, content: issue instanceof Error ? issue.message : "تعذر الوصول إلى المساعد.", error: true, pending: false, status: undefined }));
    } finally {
      setBusy(false);
    }
  }, [busy, caseId, conversationId, patchLast, reloadConversations]);

  useEffect(() => {
    const question = params.get("q");
    if (question && !started.current) {
      started.current = true;
      void ask(question);
    }
  }, [ask, params]);

  async function openConversation(id: string) {
    const { conversation } = await request<{ conversation: { id: string; legalCase: { id: string } | null; messages: { id: string; role: "USER" | "ASSISTANT"; content: string; sources: Source[] | null; drafts: DraftRef[] | null; createdAt: string }[] } }>(`/api/assistant/conversations?id=${id}`);
    setConversationId(conversation.id);
    setCaseId(conversation.legalCase?.id ?? "");
    setMessages(conversation.messages.map((message) => ({ key: message.id, role: message.role, content: message.content, sources: message.sources ?? [], drafts: message.drafts ?? [], at: message.createdAt })));
    setHistory(false);
  }

  function newChat() {
    setMessages([]);
    setConversationId(undefined);
    setHistory(false);
  }

  async function removeConversation(id: string) {
    await send(`/api/assistant/conversations?id=${id}`, "DELETE");
    if (id === conversationId) newChat();
    await reloadConversations();
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    if (!caseId) {
      setUploadNote("اختر القضية أولاً ثم أرفق المستند.");
      return;
    }
    setUploadNote(`جارٍ رفع «${chosen.name}»...`);
    const form = new FormData();
    form.set("file", chosen);
    form.set("caseId", caseId);
    try {
      const { document } = await request<{ document: { extraction: string; title: string } }>("/api/documents", { method: "POST", body: form });
      setUploadNote(document.extraction === "READY" ? `أُضيف «${document.title}» إلى ملف القضية ويمكنك السؤال عنه.` : `حُفظ «${document.title}» لكن تعذر استخراج نصه.`);
      await reloadCase();
    } catch (issue) {
      setUploadNote(issue instanceof Error ? issue.message : "تعذر رفع الملف.");
    }
  }

  const openSource = (source: Source) => {
    if (source.documentId) setViewing({ id: source.documentId, page: source.page });
    else if (source.href) router.push(source.href);
  };

  const caseRef = file ? `القضية ${file.caseNumber}` : "القضية";
  const suggestions = [
    { icon: CalendarDays, label: "ما موعد الجلسة القادمة؟", text: `ما موعد الجلسة القادمة في ${caseRef}؟` },
    { icon: ListChecks, label: "لخّص ملف القضية", text: `لخّص لي ${caseRef}، واحكيلي شو آخر قرار وشو لازم أجهز للجلسة القادمة.` },
    { icon: Folder, label: "أعرض المستندات", text: `اعرض مستندات ${caseRef} وما يتضمنه كل منها باختصار.` },
    { icon: BarChart3, label: "جهّز تقرير الحالة", text: `جهّز مسودة تقرير عن حالة ${caseRef} للمراجعة.` },
  ];
  const lastDecision = file?.hearings.find((hearing) => hearing.decision);
  const nextHearing = file ? [...file.hearings].reverse().find((hearing) => new Date(hearing.startsAt) > new Date()) : undefined;

  return (
    <div className="chat-layout">
      <section className="chat">
        <header className="chat-head">
          <div className="chat-tools">
            <span className="online-pill"><i className="dot" /> متصل الآن</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setHistory(true)}><History size={16} /> المحادثات</button>
            <button className="btn btn-ghost btn-sm" onClick={newChat}><Plus size={16} /> جديدة</button>
          </div>
          <div className="chat-title"><div><h1><i className="dot" /> مساعد ريزونكس الذكي</h1><p>مساعدك القانوني الذكي</p></div><Image src="/images/robot-chat.jpg" alt="مساعد ريزونكس" width={176} height={138} priority /></div>
        </header>

        <div className="chat-scroll" ref={scroller} aria-live="polite">
          {messages.length === 0 && (
            <div className="chat-welcome"><Image className="welcome-robot" src="/images/robot-avatar.jpg" alt="" width={120} height={120} /><h2>أهلاً {user.name}</h2><p>اسأل عن أي قضية أو جلسة أو مستند. أبحث في ملفات المكتب وأعرض لك مصدر كل معلومة، والقرار يبقى لك.</p></div>
          )}
          {messages.map((message) => message.role === "USER" ? (
            <div className="msg msg-user" key={message.key}>
              <div className="msg-avatar"><UserAvatar user={user} /></div>
              <div className="bubble"><p>{message.content}</p><small>{clock(message.at)} <CheckCheck size={14} /></small></div>
            </div>
          ) : (
            <div className="msg" key={message.key}>
              <div className="msg-avatar bot"><Image src="/images/robot-avatar.jpg" alt="مساعد ريزونكس" width={84} height={84} /></div>
              <div className={`bubble ${message.error ? "bubble-error" : ""}`}>
                {message.status && <p className="typing"><span /><span /><span /> {message.status}</p>}
                {message.content && <RichText text={message.content} sources={message.pending ? [] : message.sources ?? []} onCite={openSource} />}
                {!!message.sources?.length && (
                  <div className="sources">
                    <b><FileText size={15} /> المصدر:</b>
                    {message.sources.map((source, index) => (
                      <div className="source" key={source.id}>
                        <span><em>{index + 1}</em>{source.label}{source.detail ? <small> ({source.detail})</small> : null}</span>
                        <button className="btn btn-outline btn-sm" onClick={() => openSource(source)}><Eye size={15} /> {source.documentId ? "عرض المستند" : "عرض السجل"}</button>
                      </div>
                    ))}
                  </div>
                )}
                {!message.pending && !message.error && !message.sources?.length && message.content && (
                  <p className="no-source"><AlertTriangle size={14} /> هذه الإجابة غير مسندة إلى سجل أو مستند في المكتب.</p>
                )}
                {!!message.warnings?.length && (
                  <p className="no-source"><AlertTriangle size={14} /> لم تُطابق هذه القيم أي سجل، تحقق منها: {message.warnings.join("، ")}</p>
                )}
                {message.drafts?.map((draft) => (
                  <Link key={draft.id} href={draft.href} className="btn btn-outline draft-link"><FileEdit size={17} /> فتح المسودة: {draft.title}</Link>
                ))}
                {!!message.drafts?.length && <p className="draft-hint">يمكنك مراجعتها وتعديلها قبل اعتمادها.</p>}
                <small>{clock(message.at)}</small>
              </div>
            </div>
          ))}
        </div>

        {uploadNote && <p className="upload-note">{uploadNote}</p>}
        <form className="composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void ask(input); }}>
          <button className="send-btn send-lg" aria-label="إرسال" disabled={busy || !input.trim()}><Send size={21} /></button>
          <textarea
            rows={1}
            value={input}
            placeholder="اكتب سؤالك هنا..."
            aria-label="سؤالك"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(input);
              }
            }}
          />
          <button type="button" className="icon-btn" aria-label="إرفاق مستند بالقضية" onClick={() => fileInput.current?.click()}><Paperclip size={22} /></button>
          <input type="file" hidden ref={fileInput} accept={DOCUMENT_ACCEPT} onChange={upload} />
        </form>
      </section>

      <aside className="chat-side">
        <section className="case-panel">
          <header><Scale size={22} /><h2>معلومات القضية</h2></header>
          <select aria-label="اختر القضية" value={caseId} onChange={(event) => setCaseId(event.target.value)}>
            <option value="">اختر قضية...</option>
            {caseList?.cases.map((item) => <option key={item.id} value={item.id}>{item.caseNumber} — {item.title}</option>)}
          </select>
          {file ? (
            <dl>
              <div><dt><Hash size={15} /> رقم القضية</dt><dd><Link href={`/app/cases/${file.id}`}>{file.caseNumber}</Link></dd></div>
              <div><dt><UserRound size={15} /> العميل</dt><dd>{file.client.name}</dd></div>
              <div><dt><Scale size={15} /> النوع</dt><dd>{caseTypes[file.type]}</dd></div>
              <div><dt><Building2 size={15} /> المحكمة</dt><dd>{courts[file.court]}{file.courtCity ? ` ${file.courtCity}` : ""}</dd></div>
              <div><dt><Zap size={15} /> الحالة</dt><dd><Pill tone={file.status === "IN_PROGRESS" ? "good" : "neutral"}>{caseStatuses[file.status]}</Pill></dd></div>
              <div><dt><CalendarDays size={15} /> موعد الجلسة القادمة</dt><dd>{nextHearing ? formatDate(nextHearing.startsAt) : "غير محدد"}</dd></div>
            </dl>
          ) : <p className="case-panel-hint">اختر قضية ليبقى سياقها أمامك أثناء المحادثة.</p>}
        </section>

        <section className="card suggestions">
          <h2><Zap size={18} /> اقتراحات سريعة</h2>
          {suggestions.map(({ icon: Icon, label, text }) => (
            <button key={label} className="quick" disabled={busy} onClick={() => void ask(text)}><Icon size={16} /><span>{label}</span></button>
          ))}
        </section>

        {lastDecision && (
          <section className="card tip">
            <h2><Lightbulb size={18} /> معلومة مهمة</h2>
            <p>آخر قرار مسجل بتاريخ {formatDate(lastDecision.startsAt)}: {lastDecision.decision}</p>
          </section>
        )}
      </aside>

      {viewing && <DocumentViewer id={viewing.id} page={viewing.page} onClose={() => setViewing(null)} />}
      {history && (
        <Modal title="المحادثات السابقة" onClose={() => setHistory(false)}>
          {conversations?.conversations.length ? (
            <ul className="history">
              {conversations.conversations.map((item) => (
                <li key={item.id}>
                  <button onClick={() => void openConversation(item.id)}><b>{item.title}</b><small>{item.legalCase ? `القضية ${item.legalCase.caseNumber} · ` : ""}{formatDate(item.updatedAt)}</small></button>
                  <button className="icon-btn" aria-label="حذف المحادثة" onClick={() => void removeConversation(item.id)}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="confirm-body">لا توجد محادثات سابقة.</p>}
        </Modal>
      )}
    </div>
  );
}

export default function AssistantPage() {
  return <Suspense><Assistant /></Suspense>;
}
