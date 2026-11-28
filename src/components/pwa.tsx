"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";

// تسجيل Service Worker تلقائياً في كل البيئات (بما فيها التطوير للتجربة).
export function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}

// زر مدمج للترويسة (بجانب تسجيل الدخول): يختفي إن كان التطبيق مثبتاً.
export function InstallHeaderButton() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [hidden, setHidden] = useState(true); // SSR: مخفي حتى يقيس العميل الوضع، فلا وميض

  useEffect(() => {
    setHidden(
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

  if (hidden || installed) return null;

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else {
      // بلا نافذة رسمية (iOS أو متصفح بلا دعم): افتح إرشاد التثبيت العائم
      document.dispatchEvent(new CustomEvent("reasonix:show-install-guide"));
    }
  };

  return (
    <button className="site-header-install" onClick={install} aria-label="تثبيت التطبيق" title="تثبيت التطبيق على جهازك">
      <Download size={16} />
      <span>تثبيت التطبيق</span>
    </button>
  );
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

  // زر الترويسة يستدعي هذا الزر العائم عندما لا توجد نافذة تثبيت رسمية
  useEffect(() => {
    const show = () => setDismissed(false);
    document.addEventListener("reasonix:show-install-guide", show);
    return () => document.removeEventListener("reasonix:show-install-guide", show);
  }, []);

  if (installed) return null;
  if (dismissed) return null;

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const iOS = /iphone|ipad|ipod/i.test(ua);
  // الزر يظهر دائماً لغير المثبتين: على أندرويد وسطح المكتب يفتح النافذة الرسمية إن توفّرت،
  // وإلا يعرض الإرشاد المناسب لمنصة المستخدم (تثبيت من قائمة المتصفح، أو إضافة للشاشة الرئيسية).

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
          ) : iOS ? (
            <p className="mb-3 text-sm opacity-80">
              من شريط Safari اختر <strong>مشاركة</strong> ⬆️ ثم <strong>إضافة إلى الشاشة الرئيسية</strong>.
            </p>
          ) : (
            <p className="mb-3 text-sm opacity-80">
              من قائمة المتصفح اختر <strong>تثبيت التطبيق</strong>، أو استخدم أيقونة <strong>⊕</strong> في شريط العنوان، ثم اضغط تثبيت.
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
