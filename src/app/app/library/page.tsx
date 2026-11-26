"use client";

import { AlertCircle, BookOpen, Download, Eye, FileText, Plus, Search, Trash2, Upload } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useUser } from "@/components/AppShell";
import { Confirm, DOCUMENT_ACCEPT, Empty, formatDate, Loader, Modal, PageHead, request, useData } from "@/components/ui";

type Source = {
  id: string;
  title: string;
  reference: string;
  fileName: string | null;
  size: number | null;
  officialType: string | null;
  officialStatus: string | null;
  officialUrl: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  _count: { articles: number };
};
type Detail = { source: Source & { articles: { id: string; number: string; text: string }[] } };

const size = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} ميغابايت` : `${Math.ceil(bytes / 1024)} كيلوبايت`);

function AddSource({ onClose, onSaved }: { onClose: () => void; onSaved: (notice: string) => Promise<unknown> }) {
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    setFile(picked);
    if (!title) setTitle(picked.name.replace(/\.[^.]+$/, ""));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === "file" && !file) return setError("اختر ملفاً.");
    setBusy(true);
    setError("");
    try {
      let result: { articles: number; unread?: boolean };
      if (mode === "file") {
        form.set("file", file as File);
        result = await request("/api/library", { method: "POST", body: form });
      } else {
        result = await request("/api/library", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      }
      await onSaved(result.unread
        ? "حُفظ الملف، لكن لم يُستخرج منه نص (ملف ممسوح أو صورة). فعّل القراءة بالذكاء الاصطناعي من الإعدادات ثم أعد رفعه ليستطيع المساعد البحث فيه."
        : `أُضيف النص وقُسِّم إلى ${result.articles} مادة.`);
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر الحفظ.");
      setBusy(false);
    }
  }

  return (
    <Modal title="إضافة نص قانوني" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="wide tabs" role="radiogroup" aria-label="طريقة الإضافة">
          <button type="button" role="radio" aria-checked={mode === "file"} className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}><Upload size={15} /> رفع ملف</button>
          <button type="button" role="radio" aria-checked={mode === "text"} className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}><FileText size={15} /> لصق النص</button>
        </div>
        {mode === "file" && (
          <label
            className={`file-drop wide ${over ? "over" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => { event.preventDefault(); setOver(false); pick(event.dataTransfer.files[0]); }}
          >
            <Upload size={26} />
            <b>{file ? file.name : "اسحب الملف هنا أو اضغط للاختيار"}</b>
            <span>{file ? size(file.size) : "PDF أو Word (docx) أو صورة أو نص، حتى 15 ميغابايت"}</span>
            <input type="file" accept={DOCUMENT_ACCEPT} onChange={(event) => pick(event.target.files?.[0])} />
          </label>
        )}
        <label className="wide"><span>اسم القانون *</span><input name="title" required minLength={2} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="wide"><span>المرجع الرسمي (مثل رقم الجريدة الرسمية) *</span><input name="reference" required minLength={2} /></label>
        {mode === "text" && (
          <label className="wide"><span>النص الكامل *</span><textarea name="text" required minLength={10} rows={10} placeholder="الصق النص كما ورد. يُقسَّم تلقائياً عند كل «المادة»." /></label>
        )}
        <p className="form-note wide">يُقسَّم النص إلى مواد عند كل «المادة»، ويُحفظ الملف الأصلي للتنزيل. الملفات الممسوحة والصور تحتاج تفعيل القراءة بالذكاء الاصطناعي.</p>
        {error && <div className="notice notice-error wide"><AlertCircle size={16} />{error}</div>}
        <div className="form-actions wide">
          <button type="button" className="btn btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold" disabled={busy}>{busy ? (mode === "file" ? "جارٍ الرفع والقراءة..." : "جارٍ الحفظ...") : "حفظ"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function LibraryPage() {
  const user = useUser();
  const { data, error, reload } = useData<{ sources: Source[] }>("/api/library");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<Source | null>(null);
  const { data: detail } = useData<Detail>(viewing ? `/api/library?id=${viewing}` : null);
  const senior = user.role === "SENIOR_LAWYER";
  const normalizedQuery = query.trim().toLocaleLowerCase("ar");
  const visibleSources = data?.sources.filter((source) =>
    `${source.title} ${source.reference}`.toLocaleLowerCase("ar").includes(normalizedQuery),
  ) ?? [];

  return (
    <>
      <PageHead title="المكتبة القانونية" subtitle="يستند المساعد إلى النصوص المرفوعة هنا فقط، لا إلى ذاكرته." action={senior && <button className="btn btn-gold" onClick={() => setAdding(true)}><Plus size={17} /> إضافة نص أو ملف</button>} />
      {notice && <div className="notice notice-gold" role="status" onClick={() => setNotice("")}><AlertCircle size={16} />{notice}</div>}
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : data.sources.length === 0 ? <Empty title="لا توجد نصوص قانونية" hint="ارفع القوانين (PDF أو Word) أو الصق نصها من مصدر معتمد ليستطيع المساعد الاستناد إليها." icon={<BookOpen size={28} />} /> : (
          <>
          <label className="search-box" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Search size={17} aria-hidden="true" />
            <input aria-label="ابحث في التشريعات" placeholder="ابحث باسم التشريع أو مرجعه الرسمي" value={query} onChange={(event) => setQuery(event.target.value)} />
            <span className="muted">{visibleSources.length} / {data.sources.length}</span>
          </label>
          {visibleSources.length === 0 ? <Empty title="لا توجد نتائج" hint="جرّب البحث باسم آخر أو بالمرجع الرسمي." icon={<Search size={28} />} /> : <ul className="rows">{visibleSources.map((source) => (
            <li key={source.id}>
              <span>
                {source.title}
                <small>
                  {source.reference} · {source._count.articles ? `${source._count.articles} مادة` : "دون نص مستخرج"}
                  {source.fileName ? ` · ${source.fileName}` : ""}
                  {source.officialStatus ? ` · ${source.officialStatus}` : ""}
                  {source.lastVerifiedAt ? ` · تحقق رسمي ${formatDate(source.lastVerifiedAt)}` : ""}
                  {" · "}{formatDate(source.createdAt)}
                  {source.officialUrl && <> · <a href={source.officialUrl} target="_blank" rel="noreferrer">المصدر الرسمي</a></>}
                </small>
              </span>
              <span className="row-actions">
                {source._count.articles > 0 && <button className="icon-btn" aria-label={`عرض ${source.title}`} onClick={() => setViewing(source.id)}><Eye size={16} /></button>}
                {source.fileName && <a className="icon-btn" aria-label={`تنزيل ${source.fileName}`} href={`/api/library?file=${source.id}&download=1`}><Download size={16} /></a>}
                {senior && <button className="icon-btn" aria-label={`حذف ${source.title}`} onClick={() => setRemoving(source)}><Trash2 size={15} /></button>}
              </span>
            </li>
          ))}</ul>}
          </>
        )}
      </section>
      {adding && <AddSource onClose={() => setAdding(false)} onSaved={async (message) => { setNotice(message); await reload(); }} />}
      {viewing && (
        <Modal title={detail?.source.title ?? "النص القانوني"} wide onClose={() => setViewing(null)}>
          {!detail ? <Loader /> : (
            <>
              {detail.source.fileName && <p className="form-note"><a href={`/api/library?file=${viewing}`} target="_blank" rel="noreferrer">فتح الملف الأصلي: {detail.source.fileName}</a></p>}
              <div className="viewer-page">{detail.source.articles.map((article) => <section key={article.id}><h3>المادة {article.number}</h3><p>{article.text}</p></section>)}</div>
            </>
          )}
        </Modal>
      )}
      {removing && <Confirm title="حذف النص" body={`حذف «${removing.title}» من المكتبة؟`} action="حذف" danger onClose={() => setRemoving(null)} onConfirm={async () => { await request(`/api/library?id=${removing.id}`, { method: "DELETE" }); await reload(); }} />}
    </>
  );
}
