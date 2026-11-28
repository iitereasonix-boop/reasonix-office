"use client";

import { useEffect, useState } from "react";

// تسجيل Service Worker تلقائياً في بيئة الإنتاج (وفي وضع التطوير أيضاً للتجربة).
export function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && !new URLSearchParams(window.location.search).has("sw")) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// زر «تثبيت التطبيق على جهازك» — يظهر فقط للتطبيقات غير المثبتة، ويدعم
// Chrome/Edge/Android عبر beforeinstallprompt، وتثبيت Safari عبر إرشاد يدوي.
export function InstallButton() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (dismissed) window.localStorage.setItem("reasonix-install-dismissed", "1");
  }, [dismissed]);

  if (installed) return null;
  if (dismissed) return null;

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const iOS = /iphone|ipad|ipod/i.test(ua);
  const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);

  if (!deferred && !(iOS && safari)) return null;
  // لا تظهر على أندرويد/سطح المكتب إلا بعد أطلاق الحدث الرسمي؛ وعلى iOS في Safari فقط

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setDeferred(null);
    }
  };

  return (
    <div
      dir="rtl"
      className="fixed bottom-4 left-4 z-50 max-w-xs rounded-xl border border-[var(--line,rgba(224,186,114,.35))] bg-[var(--panel,#111d31)] p-4 shadow-2xl backdrop-blur"
      role="dialog"
      aria-label="تثبيت التطبيق"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="mb-1 font-bold text-[var(--gold,#e0ba72)]">تثبيت التطبيق على جهازك</p>
          {deferred ? (
            <p className="mb-3 text-sm opacity-80">ثبّت «ريزونكس ونهار» كتطبيق مستقل بأيقونة خاصة، يعمل بنافذة كاملة بلا شريط متصفح.</p>
          ) : (
            <p className="mb-3 text-sm opacity-80">
              على آيفون أو آيباد: من شريط Safari اختر <strong>مشاركة</strong> ثم <strong>إضافة إلى الشاشة الرئيسية</strong>.
            </p>
          )}
          <div className="flex gap-2">
            {deferred && (
              <button
                onClick={install}
                className="rounded-lg bg-[var(--gold,#e0ba72)] px-4 py-2 text-sm font-bold text-[#0b1526]"
              >
                تثبيت
              </button>
            )}
            <button
              onClick={() => setDismissed(true)}
              className="rounded-lg border border-current px-4 py-2 text-sm opacity-70 hover:opacity-100"
            >
              لاحقاً
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
