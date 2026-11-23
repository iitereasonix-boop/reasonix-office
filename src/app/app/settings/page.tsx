"use client";

import { CalendarSync, ImagePlus, KeyRound, Plus, RotateCcw, ShieldCheck, Trash2, Upload, UserCheck, UserX } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useUser } from "@/components/AppShell";
import { actionLabel } from "@/components/case-status";
import { caseTypes, courts, formatDateTime, FormFields, FormModal, Loader, Modal, PageHead, Pill, request, roleLabels, send, Toast, useData, type Field } from "@/components/ui";
import { OFFICE_PHOTO_MAX_BYTES, OFFICE_PHOTO_MIME_TYPES } from "@/lib/office-photo";

const profileFields = (name: string): Field[] => [{ name: "name", label: "الاسم المعروض", required: true, defaultValue: name, wide: true }];
const passwordFields: Field[] = [
  { name: "currentPassword", label: "كلمة المرور الحالية", type: "password", required: true, dir: "ltr" },
  { name: "newPassword", label: "كلمة المرور الجديدة (10 محارف على الأقل)", type: "password", required: true, dir: "ltr" },
];

export default function SettingsPage() {
  const user = useUser();
  const [toast, setToast] = useState("");
  const [failure, setFailure] = useState("");

  function saveForm(reset: boolean, message: string) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFailure("");
      const form = event.currentTarget;
      try {
        await send("/api/profile", "PATCH", Object.fromEntries(new FormData(form).entries()));
        setToast(message);
        if (reset) form.reset();
        else window.location.reload();
      } catch (issue) {
        setFailure(issue instanceof Error ? issue.message : "تعذر الحفظ.");
      }
    };
  }

  return (
    <>
      <PageHead title="الإعدادات" subtitle={`${user.email} · ${roleLabels[user.role]}`} />
      {failure && <div className="notice notice-error">{failure}</div>}
      <div className="report-grid">
        <section className="card card-pad"><h2>الملف الشخصي</h2>
          <form className="form-grid" onSubmit={saveForm(false, "حُفظ الاسم")}><FormFields fields={profileFields(user.name)} /><div className="form-actions wide"><button className="btn btn-gold">حفظ</button></div></form>
        </section>
        <section className="card card-pad"><h2>كلمة المرور</h2>
          <form className="form-grid" onSubmit={saveForm(true, "تغيّرت كلمة المرور")}><FormFields fields={passwordFields} /><div className="form-actions wide"><button className="btn btn-gold">تغيير</button></div></form>
        </section>
      </div>
      <CalendarFeed />
      {user.role === "SENIOR_LAWYER" && <Team />}
      {user.role === "SENIOR_LAWYER" && <OfficeControls />}
      {toast && <Toast text={toast} onDone={() => setToast("")} />}
    </>
  );
}

function CalendarFeed() {
  const [url, setUrl] = useState("");
  async function issue() {
    const { token } = await send<{ token: string }>("/api/calendar", "POST");
    setUrl(`${window.location.origin}/api/calendar?token=${token}`);
  }
  return (
    <section className="card card-pad team-card">
      <h2>ربط التقويم</h2>
      <p className="muted">أضف هذا الرابط إلى Google Calendar من «إضافة تقويم عبر عنوان URL». إنشاء رابط جديد يلغي السابق.</p>
      {url && <input readOnly value={url} dir="ltr" aria-label="رابط التقويم" onFocus={(event) => event.target.select()} />}
      <div className="form-actions"><button className="btn btn-ghost" onClick={() => void issue()}><CalendarSync size={16} /> إنشاء رابط</button></div>
    </section>
  );
}

type Office = {
  settings: { aiEnabled: boolean; aiEnabledAt: string | null; quietStart: number; quietEnd: number; staleDays: number; officeWhatsapp: string | null; officeAddress: string | null; officeMapUrl: string | null; officePhotoMimeType: string | null; updatedAt: string };
  rules: { id: string; name: string; days: number; base: string; legalBasis: string; caseType: string | null; court: string | null; rollForward: boolean; pauseInVacation: boolean }[];
  holidays: { id: string; name: string; startsOn: string; endsOn: string; kind: string }[];
  templates: { kind: string; name: string; body: string; metaName: string | null; autoSend: boolean; active: boolean }[];
  integrations: { claudeKey: boolean; aiProvider: string | null; whatsapp: boolean };
};

function OfficeControls() {
  const { data, error, reload } = useData<Office>("/api/office");
  const [dialog, setDialog] = useState<"" | "rule" | "holiday" | "general" | "ai" | "trash" | "audit" | "agents">("");
  const [template, setTemplate] = useState<Office["templates"][number] | null>(null);
  if (!data) return <Loader error={error} retry={reload} />;
  const { settings, rules, templates, integrations, holidays } = data;

  return (
    <>
      <OfficePhoto settings={settings} reload={reload} />
      <OfficeContact settings={settings} reload={reload} />
      <div className="report-grid team-card">
        <AiKey saved={integrations.claudeKey} reload={reload} />
        <section className="card card-pad">
          <h2>الذكاء الاصطناعي والخصوصية</h2>
          <p className="muted">عند التفعيل يُرسل محتوى القضايا والمستندات التي يطلبها المستخدمون إلى {integrations.aiProvider ?? "مزود الذكاء الاصطناعي"}. يبقى متوقفاً حتى يوافق المكتب، ويتوقف عند تغيير المزود.</p>
          <p>{settings.aiEnabled ? <Pill tone="good">مفعّل</Pill> : <Pill tone="warn">متوقف</Pill>} </p>
          <div className="form-actions"><button className={`btn ${settings.aiEnabled ? "btn-ghost" : "btn-gold"}`} onClick={() => setDialog("ai")}>{settings.aiEnabled ? "إيقاف" : "تفعيل"}</button></div>
        </section>
        <section className="card card-pad">
          <h2>ساعات الإرسال والمتابعة</h2>
          <p className="muted">الإرسال من {settings.quietStart}:00 إلى {settings.quietEnd}:00. تظهر القضية كخاملة بعد {settings.staleDays} يوماً بلا تحديث. واتساب: {integrations.whatsapp ? "مربوط" : "غير مربوط"}.</p>
          <div className="form-actions"><button className="btn btn-ghost" onClick={() => setDialog("general")}>تعديل</button></div>
        </section>
      </div>

      <section className="card team-card">
        <header className="card-head"><h2>قواعد مواعيد الطعن</h2><button className="link-btn" onClick={() => setDialog("rule")}><Plus size={16} /> إضافة قاعدة</button></header>
        {rules.length === 0 ? <p className="confirm-body">لا توجد قواعد. يحددها المحامي مع سندها، ولا يفترض النظام أي مدة.</p> : (
          <ul className="rows">{rules.map((rule) => (
            <li key={rule.id}>
              <span>{rule.name}<small>{rule.days} يوماً من {rule.base === "NOTIFICATION" ? "التبليغ" : "الحكم"} · {rule.legalBasis}{rule.caseType ? ` · ${caseTypes[rule.caseType]}` : ""}{rule.court ? ` · ${courts[rule.court]}` : ""}{rule.pauseInVacation ? " · يتوقف العدّ في العطلة القضائية" : ""}{rule.rollForward ? " · يُنقل آخر يوم إذا وافق عطلة" : ""}</small></span>
              <button className="icon-btn" aria-label={`حذف ${rule.name}`} onClick={async () => { await send(`/api/office?id=${rule.id}`, "DELETE"); await reload(); }}><Trash2 size={15} /></button>
            </li>
          ))}</ul>
        )}
      </section>

      <section className="card team-card">
        <header className="card-head"><h2>العطل الرسمية والعطلة القضائية</h2><button className="link-btn" onClick={() => setDialog("holiday")}><Plus size={16} /> إضافة عطلة</button></header>
        {holidays.length === 0 ? <p className="confirm-body">لا توجد عطل مدخلة. أدخلها من التقويم الرسمي، ولا يفترض النظام أي تاريخ.</p> : (
          <ul className="rows">{holidays.map((holiday) => (
            <li key={holiday.id}>
              <span>{holiday.name}<small>{holiday.kind === "JUDICIAL_VACATION" ? "عطلة قضائية" : "عطلة رسمية"} · {holiday.startsOn.replaceAll("-", "/")}{holiday.endsOn !== holiday.startsOn ? ` إلى ${holiday.endsOn.replaceAll("-", "/")}` : ""}</small></span>
              <button className="icon-btn" aria-label={`حذف ${holiday.name}`} onClick={async () => { await send(`/api/office?holiday=${holiday.id}`, "DELETE"); await reload(); }}><Trash2 size={15} /></button>
            </li>
          ))}</ul>
        )}
      </section>

      <section className="card team-card">
        <header className="card-head"><h2>قوالب التذكير</h2></header>
        <ul className="rows">{templates.map((item) => (
          <li key={item.kind}>
            <span>{item.name}<small>{item.body}</small></span>
            {item.autoSend && <Pill tone="warn">إرسال تلقائي</Pill>}
            <button className="btn btn-ghost btn-sm" onClick={() => setTemplate(item)}>تعديل</button>
          </li>
        ))}</ul>
      </section>

      <section className="card card-pad team-card">
        <h2>السجلات والاسترجاع</h2>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={() => setDialog("trash")}><RotateCcw size={16} /> سلة المحذوفات</button>
          <button className="btn btn-ghost" onClick={() => setDialog("audit")}><ShieldCheck size={16} /> سجل التدقيق</button>
          <button className="btn btn-ghost" onClick={() => setDialog("agents")}><ShieldCheck size={16} /> سجل الوكلاء</button>
        </div>
      </section>

      {dialog === "ai" && (
        <FormModal
          title={settings.aiEnabled ? "إيقاف الذكاء الاصطناعي" : "تفعيل الذكاء الاصطناعي"}
          fields={[]}
          note={settings.aiEnabled ? "سيتوقف المساعد والتوزيع وقراءة الملفات الممسوحة." : `أؤكد موافقة المكتب على إرسال محتوى القضايا إلى ${integrations.aiProvider ?? "مزود الذكاء الاصطناعي"} وفق التزامات السرية.`}
          submitLabel={settings.aiEnabled ? "إيقاف" : "أوافق وأفعّل"}
          onClose={() => setDialog("")}
          onSubmit={async () => { await send("/api/office", "PATCH", { aiEnabled: !settings.aiEnabled }); await reload(); }}
        />
      )}
      {dialog === "general" && (
        <FormModal
          title="ساعات الإرسال والمتابعة"
          fields={[
            { name: "quietStart", label: "بداية الإرسال (ساعة)", type: "number", required: true, defaultValue: String(settings.quietStart) },
            { name: "quietEnd", label: "نهاية الإرسال (ساعة)", type: "number", required: true, defaultValue: String(settings.quietEnd) },
            { name: "staleDays", label: "أيام القضية الخاملة", type: "number", required: true, defaultValue: String(settings.staleDays) },
          ]}
          onClose={() => setDialog("")}
          onSubmit={async (values) => { await send("/api/office", "PATCH", values); await reload(); }}
        />
      )}
      {dialog === "rule" && (
        <FormModal
          title="قاعدة موعد طعن"
          fields={[
            { name: "name", label: "اسم القاعدة", required: true, wide: true },
            { name: "days", label: "عدد الأيام", type: "number", required: true },
            { name: "base", label: "يبدأ من", type: "select", required: true, defaultValue: "NOTIFICATION", options: [["NOTIFICATION", "تاريخ التبليغ"], ["DECISION", "تاريخ الحكم"]] },
            { name: "caseType", label: "نوع القضية", type: "select", placeholder: "الكل", options: Object.entries(caseTypes) },
            { name: "court", label: "درجة المحكمة", type: "select", placeholder: "الكل", options: Object.entries(courts) },
            { name: "legalBasis", label: "السند القانوني", required: true, wide: true },
            { name: "pauseInVacation", label: "العطلة القضائية", type: "select", required: true, defaultValue: "0", options: [["0", "لا تؤثر على العدّ"], ["1", "يتوقف العدّ خلالها"]] },
            { name: "rollForward", label: "إذا وافق آخر يوم عطلة", type: "select", required: true, defaultValue: "0", options: [["0", "يبقى كما هو"], ["1", "يُنقل لأول يوم عمل"]] },
          ]}
          note="يعرض النظام هذه القاعدة بجانب كل موعد ويطلب تأكيدك عليه. أيام العمل تستثني الجمعة والسبت والعطل المدخلة أدناه."
          onClose={() => setDialog("")}
          onSubmit={async (values) => { await send("/api/office", "POST", { ...values, pauseInVacation: values.pauseInVacation === "1", rollForward: values.rollForward === "1" }); await reload(); }}
        />
      )}
      {dialog === "holiday" && (
        <FormModal
          title="إضافة عطلة"
          fields={[
            { name: "name", label: "الاسم", required: true, wide: true, placeholder: "عيد الفطر" },
            { name: "kind", label: "النوع", type: "select", required: true, defaultValue: "HOLIDAY", options: [["HOLIDAY", "عطلة رسمية"], ["JUDICIAL_VACATION", "عطلة قضائية"]] },
            { name: "startsOn", label: "من", type: "date", required: true },
            { name: "endsOn", label: "إلى (لعطلة يوم واحد اتركه فارغاً)", type: "date" },
          ]}
          onClose={() => setDialog("")}
          onSubmit={async (values) => {
            const day = (value: unknown) => new Date(String(value)).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
            const startsOn = day(values.startsOn);
            await send("/api/office?target=holiday", "POST", { name: values.name, kind: values.kind, startsOn, endsOn: values.endsOn ? day(values.endsOn) : startsOn });
            await reload();
          }}
        />
      )}
      {template && (
        <FormModal
          title={template.name}
          fields={[
            { name: "body", label: "النص ({{1}} العميل، {{2}} رقم القضية، {{3}} التاريخ)", type: "textarea", required: true, rows: 4, defaultValue: template.body },
            { name: "metaName", label: "اسم القالب المعتمد في Meta", dir: "ltr", defaultValue: template.metaName ?? undefined, wide: true },
            { name: "autoSend", label: "الإرسال التلقائي", type: "select", required: true, defaultValue: template.autoSend ? "1" : "0", options: [["0", "متوقف: مسودة تنتظر الاعتماد"], ["1", "مفعّل: يُرسل دون اعتماد"]], wide: true },
          ]}
          note="تفعيل الإرسال التلقائي مسؤولية المحامي صاحب المكتب، ويخص هذا القالب وحده."
          onClose={() => setTemplate(null)}
          onSubmit={async (values) => { await send("/api/office?target=template", "PATCH", { ...values, kind: template.kind, autoSend: values.autoSend === "1" }); await reload(); }}
        />
      )}
      {dialog === "trash" && <Trash onClose={() => setDialog("")} />}
      {dialog === "audit" && <AuditView onClose={() => setDialog("")} />}
      {dialog === "agents" && <AgentView onClose={() => setDialog("")} />}
    </>
  );
}

function OfficePhoto({ settings, reload }: { settings: Office["settings"]; reload: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setFailure("");
    if (!next) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!OFFICE_PHOTO_MIME_TYPES.some((type) => type === next.type)) {
      setFailure("الصيغ المدعومة هي JPG وPNG وWebP فقط.");
      event.target.value = "";
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (next.size < 1 || next.size > OFFICE_PHOTO_MAX_BYTES) {
      setFailure("يجب ألا يتجاوز حجم الصورة 5 ميغابايت.");
      event.target.value = "";
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setFailure("اختر الصورة أولاً.");
      return;
    }
    setFailure("");
    setBusy(true);
    const form = event.currentTarget;
    const body = new FormData();
    body.append("photo", file);
    try {
      await request("/api/office/photo", { method: "POST", body });
      form.reset();
      setFile(null);
      setPreviewUrl(null);
      await reload();
      setToast("تم تحديث صورة المكتب");
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر حفظ الصورة.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefault() {
    if (!window.confirm("إزالة الصورة المختارة والعودة إلى الصورة الافتراضية؟")) return;
    setFailure("");
    setBusy(true);
    try {
      await request("/api/office/photo", { method: "DELETE" });
      setFile(null);
      setPreviewUrl(null);
      await reload();
      setToast("تمت استعادة الصورة الافتراضية");
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر إزالة الصورة.");
    } finally {
      setBusy(false);
    }
  }

  const photoSrc = previewUrl ?? `/api/office/photo?v=${encodeURIComponent(settings.updatedAt)}`;

  return (
    <section className="card card-pad team-card">
      <h2>صورة المكتب على الموقع</h2>
      <p className="muted">اختر الصورة التي تظهر في الصفحة الرئيسية وحساب المكتب. صيغ JPG وPNG وWebP، بحد أقصى 5 ميغابايت.</p>
      <div className="office-photo-settings">
        <div className="office-photo-preview">
          <Image src={photoSrc} alt="معاينة صورة المكتب" width={320} height={220} unoptimized />
        </div>
        <form className="office-photo-form" onSubmit={save}>
          <label className="office-photo-picker btn btn-ghost">
            <ImagePlus size={17} />
            <span>{file?.name ?? "اختيار صورة"}</span>
            <input type="file" accept={OFFICE_PHOTO_MIME_TYPES.join(",")} onChange={choosePhoto} aria-label="اختيار صورة المكتب" />
          </label>
          <p className="muted">{file ? "معاينة الصورة جاهزة؛ احفظ لاعتمادها." : settings.officePhotoMimeType ? "الصورة الحالية منشورة على الموقع." : "تُستخدم حالياً الصورة الافتراضية."}</p>
          {failure && <div className="notice notice-error">{failure}</div>}
          <div className="form-actions">
            {settings.officePhotoMimeType && <button type="button" className="btn btn-ghost" onClick={() => void restoreDefault()} disabled={busy}><RotateCcw size={16} /> الصورة الافتراضية</button>}
            <button className="btn btn-gold" disabled={!file || busy}><Upload size={16} /> {busy ? "جارٍ الحفظ..." : "حفظ الصورة"}</button>
          </div>
        </form>
      </div>
      {toast && <Toast text={toast} onDone={() => setToast("")} />}
    </section>
  );
}

function OfficeContact({ settings, reload }: { settings: Office["settings"]; reload: () => Promise<void> }) {
  const [failure, setFailure] = useState("");
  const [toast, setToast] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure("");
    const data = new FormData(event.currentTarget);
    try {
      await send("/api/office?target=contact", "PATCH", { officeWhatsapp: data.get("officeWhatsapp"), officeAddress: data.get("officeAddress"), officeMapUrl: data.get("officeMapUrl") });
      setToast("حُفظت بيانات المكتب");
      await reload();
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر الحفظ.");
    }
  }
  return (
    <section className="card card-pad team-card">
      <h2>بيانات المكتب في الموقع</h2>
      <form className="form-grid" onSubmit={save}>
        <label><span>رقم واتساب المكتب</span><input name="officeWhatsapp" type="tel" dir="ltr" placeholder="+962 7X XXX XXXX" defaultValue={settings.officeWhatsapp ?? ""} /></label>
        <label><span>عنوان المكتب</span><input name="officeAddress" defaultValue={settings.officeAddress ?? ""} /></label>
        <label className="wide"><span>رابط موقع المكتب على Google Maps</span><input name="officeMapUrl" type="url" dir="ltr" placeholder="https://maps.app.goo.gl/..." defaultValue={settings.officeMapUrl ?? ""} /></label>
        {failure && <div className="notice notice-error wide">{failure}</div>}
        <div className="form-actions wide">
          <button className="btn btn-gold">حفظ</button>
        </div>
      </form>
      {toast && <Toast text={toast} onDone={() => setToast("")} />}
    </section>
  );
}

function AiKey({ saved, reload }: { saved: boolean; reload: () => Promise<void> }) {
  const [failure, setFailure] = useState("");
  const [toast, setToast] = useState("");
  async function store(aiApiKey: string | null, message: string) {
    setFailure("");
    try {
      await send("/api/office?target=ai-key", "PATCH", { aiApiKey });
      setToast(message);
      await reload();
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر الحفظ.");
    }
  }
  return (
    <section className="card card-pad">
      <h2>مفتاح الذكاء الاصطناعي</h2>
      <p>{saved ? <Pill tone="good">المفتاح محفوظ</Pill> : <Pill tone="warn">لا يوجد مفتاح</Pill>}</p>
      <form className="form-grid" onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        await store(String(new FormData(form).get("aiApiKey")), "حُفظ المفتاح");
        form.reset();
      }}>
        <label className="wide"><span>{saved ? "استبدال المفتاح" : "المفتاح"}</span><input name="aiApiKey" type="password" required dir="ltr" autoComplete="off" /></label>
        {failure && <div className="notice notice-error wide">{failure}</div>}
        <div className="form-actions wide">
          {saved && <button type="button" className="btn btn-ghost" onClick={() => void store(null, "أزيل المفتاح")}>إزالة</button>}
          <button className="btn btn-gold">حفظ</button>
        </div>
      </form>
      {toast && <Toast text={toast} onDone={() => setToast("")} />}
    </section>
  );
}

function Trash({ onClose }: { onClose: () => void }) {
  const { data, error, reload } = useData<{ rows: { kind: string; label: string; title: string; id: string; deletedAt: string }[] }>("/api/trash");
  return (
    <Modal title="سلة المحذوفات" wide onClose={onClose}>
      {!data ? <Loader error={error} /> : data.rows.length === 0 ? <p className="confirm-body">السلة فارغة.</p> : (
        <ul className="rows">{data.rows.map((row) => (
          <li key={row.kind + row.id}>
            <span>{row.title}<small>{row.label} · {formatDateTime(row.deletedAt)}</small></span>
            <button className="btn btn-ghost btn-sm" onClick={async () => { await send("/api/trash", "POST", { kind: row.kind, id: row.id }); await reload(); }}><RotateCcw size={15} /> استرجاع</button>
          </li>
        ))}</ul>
      )}
    </Modal>
  );
}

function AuditView({ onClose }: { onClose: () => void }) {
  const { data, error } = useData<{ entries: { id: string; action: string; createdAt: string; user: { name: string }; legalCase: { caseNumber: string } | null }[] }>("/api/audit");
  return (
    <Modal title="سجل التدقيق" wide onClose={onClose}>
      {!data ? <Loader error={error} /> : (
        <ul className="rows">{data.entries.map((entry) => (
          <li key={entry.id}><span>{actionLabel(entry.action)}{entry.legalCase ? ` — ${entry.legalCase.caseNumber}` : ""}<small>{entry.user.name} · {formatDateTime(entry.createdAt)}</small></span></li>
        ))}</ul>
      )}
    </Modal>
  );
}

function AgentView({ onClose }: { onClose: () => void }) {
  const { data, error } = useData<{ runs: { id: string; agent: string; status: string; input: unknown; output: unknown; createdAt: string; user: { name: string } }[] }>("/api/audit?view=agents");
  return (
    <Modal title="سجل الوكلاء" wide onClose={onClose}>
      {!data ? <Loader error={error} /> : data.runs.length === 0 ? <p className="confirm-body">لا توجد استدعاءات بعد.</p> : (
        <ul className="rows">{data.runs.map((run) => (
          <li key={run.id}><details><summary>{run.agent} · {run.user.name} · {run.status} · {formatDateTime(run.createdAt)}</summary><pre className="agent-log" dir="ltr">{JSON.stringify({ input: run.input, output: run.output }, null, 2)}</pre></details></li>
        ))}</ul>
      )}
    </Modal>
  );
}

function Team() {
  const user = useUser();
  const { data, error, reload } = useData<{ staff: { id: string; name: string; email: string; role: string; active: boolean }[] }>("/api/team?all=1");
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState("");
  return (
    <section className="card team-card">
      <header className="card-head"><h2>فريق المكتب</h2><button className="link-btn" onClick={() => setAdding(true)}><Plus size={16} /> إضافة موظف</button></header>
      {!data ? <Loader error={error} retry={reload} /> : (
        <ul className="rows">{data.staff.map((member) => (
          <li key={member.id}>
            <span>{member.name}<small>{member.email} · {roleLabels[member.role]}</small></span>
            {!member.active && <Pill>معطّل</Pill>}
            {member.id !== user.id && (
              <button className="btn btn-ghost btn-sm" onClick={() => setResetting(member)}><KeyRound size={15} /> كلمة المرور</button>
            )}
            {member.id !== user.id && (
              <button className="btn btn-ghost btn-sm" onClick={async () => { await send(`/api/team?id=${member.id}`, "PATCH", { active: !member.active }); await reload(); }}>
                {member.active ? <><UserX size={15} /> تعطيل</> : <><UserCheck size={15} /> تفعيل</>}
              </button>
            )}
          </li>
        ))}</ul>
      )}
      {adding && (
        <FormModal
          title="إضافة موظف"
          fields={[
            { name: "name", label: "الاسم", required: true },
            { name: "email", label: "البريد الإلكتروني", type: "email", required: true, dir: "ltr" },
            { name: "password", label: "كلمة مرور مؤقتة (10 محارف على الأقل)", type: "password", required: true, dir: "ltr" },
            { name: "role", label: "الدور", type: "select", required: true, defaultValue: "TRAINEE_LAWYER", options: [["SENIOR_LAWYER", roleLabels.SENIOR_LAWYER], ["TRAINEE_LAWYER", roleLabels.TRAINEE_LAWYER], ["SECRETARY", roleLabels.SECRETARY]] },
          ]}
          onClose={() => setAdding(false)}
          onSubmit={async (values) => { await send("/api/team", "POST", values); await reload(); }}
        />
      )}
      {resetting && (
        <FormModal
          title={`كلمة مرور جديدة لـ ${resetting.name}`}
          fields={[{ name: "password", label: "كلمة مرور مؤقتة (10 محارف على الأقل)", type: "password", required: true, dir: "ltr", wide: true }]}
          note="يُسجَّل خروج الموظف من كل أجهزته. أعطه كلمة المرور بنفسك، واطلب منه تغييرها من «حسابي» بعد الدخول."
          submitLabel="تعيين"
          onClose={() => setResetting(null)}
          onSubmit={async (values) => { await send(`/api/team?id=${resetting.id}`, "PATCH", values); setToast(`تغيّرت كلمة مرور ${resetting.name}`); }}
        />
      )}
      {toast && <Toast text={toast} onDone={() => setToast("")} />}
    </section>
  );
}
