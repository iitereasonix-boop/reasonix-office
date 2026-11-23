"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Brand } from "@/components/brand";
import { send } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await send("/api/auth/login", "POST", { email: data.get("email"), password: data.get("password") });
      router.replace("/app");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر تسجيل الدخول.");
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card" method="post" onSubmit={submit}>
        <Link href="/" className="login-brand"><Brand subtitle="نظام إدارة مكتب المحاماة" size={58} /></Link>
        <h1>مرحباً بعودتك</h1>
        <label><span>البريد الإلكتروني</span><input name="email" type="email" autoComplete="username" required dir="ltr" /></label>
        <label><span>كلمة المرور</span><input name="password" type="password" autoComplete="current-password" required dir="ltr" /></label>
        {error && <div className="notice notice-error">{error}</div>}
        <button className="btn btn-gold btn-lg" disabled={busy}>{busy ? "جارٍ الدخول..." : "تسجيل الدخول"}</button>
        <button type="button" className="link-btn" aria-expanded={forgot} onClick={() => setForgot(!forgot)}>نسيت كلمة المرور؟</button>
        {forgot && (
          <div className="notice notice-gold">
            اطلب من المحامي صاحب المكتب تعيين كلمة مرور جديدة لك من «الإعدادات ← فريق المكتب».
            إن كنت صاحب المكتب، شغّل على الخادم: <bdi dir="ltr">npm run reset-password -- your@email</bdi>
          </div>
        )}
        <small><ShieldCheck size={15} /> مساحة داخلية لموظفي المكتب</small>
        <Link href="/portal" className="link-btn">هل أنت عميل؟ بوابة العملاء</Link>
      </form>
    </main>
  );
}
