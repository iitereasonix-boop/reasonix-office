"use client";

import { CalendarDays, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Brand } from "@/components/brand";
import { ApiError, caseStatuses, caseTypes, courts, formatDateTime, Pill, request, send } from "@/components/ui";

type Portal = { name: string; cases: { id: string; caseNumber: string; title: string; status: string; type: string; court: string; courtCity: string | null; hearings: { id: string; startsAt: string; purpose: string | null; courtroom: string | null }[] }[] };

export default function PortalPage() {
  const [data, setData] = useState<Portal | null>(null);
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await request<Portal>("/api/portal"));
    } catch (issue) {
      if (!(issue instanceof ApiError) || (issue.status !== 401 && issue.status !== 403)) setError("تعذر تحميل البيانات.");
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const body = await send<{ message: string }>("/api/portal/otp", "POST", { phone });
      setMessage(body.message);
      setSent(true);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر إرسال الرمز.");
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await send("/api/portal/otp", "PUT", { phone, code: new FormData(event.currentTarget).get("code") });
      await load();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر التحقق.");
    }
  }

  async function logout() {
    await send("/api/auth/logout", "POST");
    setData(null);
    setSent(false);
  }

  if (!ready) return <main className="login"><span className="spinner" /></main>;
  if (data) {
    return (
      <main className="portal">
        <header className="portal-head"><Brand subtitle="بوابة العملاء" size={46} /><button className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={15} /> خروج</button></header>
        <h1>أهلاً {data.name}</h1>
        {data.cases.length === 0 && <p className="muted">لا توجد قضايا مرتبطة برقمك.</p>}
        {data.cases.map((item) => (
          <section className="card card-pad" key={item.id}>
            <div className="wa-head"><b>القضية {item.caseNumber}</b><Pill tone="info">{caseStatuses[item.status]}</Pill></div>
            <p className="muted">{caseTypes[item.type]} · {courts[item.court]}{item.courtCity ? ` ${item.courtCity}` : ""}</p>
            <h2><CalendarDays size={17} /> الجلسات</h2>
            {item.hearings.length === 0 ? <p className="muted">لا توجد جلسات مسجلة.</p> : (
              <ul className="rows">{item.hearings.map((hearing) => <li key={hearing.id}><span>{formatDateTime(hearing.startsAt)}<small>{[hearing.purpose, hearing.courtroom].filter(Boolean).join(" · ")}</small></span></li>)}</ul>
            )}
          </section>
        ))}
      </main>
    );
  }
  return (
    <main className="login">
      {sent ? (
        <form className="login-card" onSubmit={verify}>
          <Link href="/" className="login-brand"><Brand subtitle="بوابة العملاء" size={58} /></Link>
          <h1>أدخل الرمز</h1>
          <p className="muted">{message}</p>
          <label><span>رمز التحقق</span><input name="code" inputMode="numeric" maxLength={6} required dir="ltr" autoComplete="one-time-code" /></label>
          {error && <div className="notice notice-error">{error}</div>}
          <button className="btn btn-gold btn-lg">دخول</button>
        </form>
      ) : (
        <form className="login-card" onSubmit={requestCode}>
          <Link href="/" className="login-brand"><Brand subtitle="بوابة العملاء" size={58} /></Link>
          <h1>تابع قضيتك</h1>
          <label><span>رقم الهاتف المسجل لدى المكتب</span><input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" required dir="ltr" placeholder="+962 7X XXX XXXX" /></label>
          {error && <div className="notice notice-error">{error}</div>}
          <button className="btn btn-gold btn-lg">إرسال الرمز</button>
          <small><ShieldCheck size={15} /> تعرض البوابة حالة القضية وجلساتها فقط</small>
        </form>
      )}
    </main>
  );
}
