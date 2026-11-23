/**
 * شعار ريزونكس الرسمي.
 *
 * الملفات في `public/images` مستخرجة من ملف الشعار الأصلي الذي زوّده المكتب،
 * بخلفية شفافة ودون أي تعديل على الشكل:
 *   reasonix-mark.png  — العلامة وحدها (شبكة العُقد)
 *   reasonix-word.png  — الاسم ®Reasonix
 *   reasonix-logo.png  — القفل الكامل معاً
 *
 * تُعرض عبر `mask-image` لا عبر `<img>`، فيأخذ الشعار لون النص المحيط
 * تلقائياً في الوضعين الليلي والنهاري، تماماً كما كان الشكل المتجهي يفعل.
 * لا تستبدل هذه الملفات ولا ترسم الشعار يدوياً.
 */

/** العلامة وحدها. الاسم محفوظ لأن كل شاشات النظام تستدعيه. */
export function ScaleLogo({ size = 44 }: { size?: number }) {
  return (
    <span
      className="rx-mark"
      style={{ width: size, height: size }}
      role="img"
      aria-label="شعار ريزونكس"
    />
  );
}

/** الاسم ®Reasonix، يتبع حجم الخط المحيط به. */
export function Wordmark() {
  return <span className="rx-word" role="img" aria-label="Reasonix" />;
}

/** قفل العلامة المستخدم في الترويسة والشريط الجانبي. */
export function Brand({ subtitle, size = 44 }: { subtitle: string; size?: number }) {
  return (
    <span className="brand-lockup">
      <span className="brand-scale">
        <ScaleLogo size={size} />
      </span>
      <span>
        <b>
          <Wordmark />
        </b>
        <small>{subtitle}</small>
      </span>
    </span>
  );
}

/**
 * مساعد ريزونكس: وكيل آليّ ببدلة، يحمل عقدة من الشعار على طية السترة.
 * ألوانه مشتقة من هوية المكتب البنفسجية.
 */
export function Robot({ size = 56, full = false }: { size?: number; full?: boolean }) {
  return (
    <svg
      className="robot"
      width={size}
      height={full ? size * 1.25 : size}
      viewBox={full ? "0 0 120 150" : "0 0 120 120"}
      role="img"
      aria-label="مساعد ريزونكس"
    >
      <defs>
        <linearGradient id="rx-shell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d7c6f5" />
        </linearGradient>
        <linearGradient id="rx-visor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a1356" />
          <stop offset="1" stopColor="#0a0418" />
        </linearGradient>
      </defs>
      <path d="M26 150v-22c0-20 15-32 34-32s34 12 34 32v22Z" fill="#1b1038" />
      <path d="m48 96 12 18 12-18Z" fill="#f3eefc" />
      <path d="m57 106-3 26 6 7 6-7-3-26Z" fill="#07030f" />
      <g transform="translate(70 112) scale(.5)" fill="#c084fc">
        <circle cx="16" cy="16" r="4.4" />
        <circle cx="3" cy="7" r="2.6" />
        <circle cx="29" cy="7" r="2.6" />
        <circle cx="3" cy="25" r="2.6" />
        <circle cx="29" cy="25" r="2.6" />
        <g stroke="#c084fc" strokeWidth="1.8" fill="none">
          <path d="M16 16 3 7M16 16 29 7M16 16 3 25M16 16 29 25" />
        </g>
      </g>
      <rect x="10" y="44" width="11" height="26" rx="5.5" fill="#8b5cf6" />
      <rect x="99" y="44" width="11" height="26" rx="5.5" fill="#8b5cf6" />
      <rect x="18" y="16" width="84" height="78" rx="34" fill="url(#rx-shell)" />
      <rect x="27" y="29" width="66" height="50" rx="23" fill="url(#rx-visor)" />
      <ellipse cx="46" cy="52" rx="7" ry="9" fill="#38dcf0" />
      <ellipse cx="74" cy="52" rx="7" ry="9" fill="#38dcf0" />
      <path
        d="M49 66c6 6 16 6 22 0"
        fill="none"
        stroke="#38dcf0"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path d="M60 16V7" stroke="#d7c6f5" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="6" r="4.5" fill="#c084fc" />
    </svg>
  );
}
