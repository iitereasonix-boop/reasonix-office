"use client";

import {
  BarChart3, Bell, BookOpen, Bot, BriefcaseBusiness, CalendarDays, CheckSquare, ChevronDown, FileSearch, FolderOpen, Gavel, Home, Inbox,
  CircleHelp, LogOut, Menu, MessageCircle, Moon, Receipt, Search, Settings, Sun, UsersRound, X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ApiError, formatDateTime, request, roleLabels, send, useData } from "@/components/ui";

export type User = { id: string; name: string; email: string; role: string; canViewPrivateNotes: boolean; canViewNationalId: boolean };

const UserContext = createContext<User | null>(null);

export function useUser() {
  const user = useContext(UserContext);
  if (!user) throw new Error("useUser must be used inside AppShell");
  return user;
}

type Notification = { id: string; tone: string; title: string; at: string | null; href: string };
type SearchResult = { id: string; kind: string; title: string; detail: string; href: string };

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [failure, setFailure] = useState("");
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    request<{ user: User }>("/api/auth/me")
      .then(({ user: current }) => setUser(current))
      .catch((issue: unknown) => {
        if (issue instanceof ApiError && issue.status === 401) router.replace("/login");
        else setFailure("تعذر الوصول إلى الخادم.");
      });
  }, [router]);
  useEffect(() => setDrawer(false), [pathname]);

  const chatMode = pathname.startsWith("/app/assistant");

  if (failure) return <div className="app-splash"><Brand subtitle={failure} /></div>;
  if (!user) return <div className="app-splash"><Brand subtitle="جارٍ تجهيز مكتبك..." /></div>;

  const staffNav = [
    { href: "/app", label: "الرئيسية", icon: Home },
    { href: "/app/clients", label: "العملاء", icon: UsersRound },
    { href: "/app/cases", label: "القضايا", icon: BriefcaseBusiness },
    { href: "/app/hearings", label: "الجلسات", icon: CalendarDays },
    { href: "/app/judgments", label: "الأحكام", icon: Gavel },
    { href: "/app/documents", label: "المستندات", icon: FolderOpen },
    { href: "/app/whatsapp", label: "واتساب", icon: MessageCircle },
    { href: "/app/tasks", label: "المهام", icon: CheckSquare },
    { href: "/app/reports", label: "التقارير والتحليلات", icon: BarChart3 },
    { href: "/app/settings", label: "الإعدادات", icon: Settings },
  ];
  const moreNav = [
    { href: "/app/assistant", label: "مساعد ريزونكس", icon: Bot },
    ...(user.role !== "TRAINEE_LAWYER" ? [
      { href: "/app/consultations", label: "طلبات الاستشارة", icon: Inbox },
      { href: "/app/intake", label: "توزيع الملفات", icon: FileSearch },
    ] : []),
    ...(user.role === "SENIOR_LAWYER" ? [{ href: "/app/billing", label: "الأتعاب والفواتير", icon: Receipt }] : []),
    { href: "/app/library", label: "المكتبة القانونية", icon: BookOpen },
    { href: "/app/guide", label: "دليل الاستخدام", icon: CircleHelp },
  ];

  async function logout() {
    await send("/api/auth/logout", "POST");
    router.replace("/login");
  }

  return (
    <UserContext.Provider value={user}>
      <div className={`shell ${chatMode ? "chat-mode" : ""}`}>
        {drawer && <div className="drawer-back" onClick={() => setDrawer(false)} />}
        <aside className={`side ${drawer ? "open" : ""}`}>
          <Link href="/app" className="side-brand"><Brand subtitle="نظام إدارة مكتب المحاماة" size={92} /></Link>
          <button className="icon-btn side-close" aria-label="إغلاق القائمة" onClick={() => setDrawer(false)}><X size={20} /></button>
          <nav aria-label="القائمة الرئيسية">
            {staffNav.map(({ href, label, icon: Icon }) => {
              const active = href === "/app" ? pathname === href : pathname.startsWith(href);
              return <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon size={19} /><span>{label}</span></Link>;
            })}
            <details className="side-more" open={moreNav.some(({ href }) => pathname.startsWith(href))}>
              <summary><ChevronDown size={17} /><span>المزيد</span></summary>
              {moreNav.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon size={19} /><span>{label}</span></Link>;
              })}
            </details>
          </nav>
          {chatMode && <div className="side-art" aria-hidden="true" />}
          <button className="side-logout" onClick={logout}><LogOut size={18} /> تسجيل الخروج</button>
        </aside>
        <div className="main">
          <header className="top">
            <button className="icon-btn top-menu" aria-label="القائمة" onClick={() => setDrawer(true)}><Menu size={21} /></button>
            <Link href="/app" className="top-brand"><Brand subtitle="نظام إدارة مكتب المحاماة" size={58} /></Link>
            <GlobalSearch />
            <ThemeToggle />
            <Notifications />
            <UserMenu user={user} logout={logout} />
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
    </UserContext.Provider>
  );
}

function useClickAway(onAway: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onAway();
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [onAway]);
  return ref;
}

export function UserAvatar({ user, online }: { user: User; online?: boolean }) {
  return (
    <span className="avatar">
      {user.role === "SENIOR_LAWYER" ? <Image src="/api/office/photo" alt="" width={46} height={46} unoptimized /> : <span>{user.name.slice(0, 1)}</span>}
      {online && <i />}
    </span>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => setTheme(document.documentElement.dataset.theme || "dark"), []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("reasonix-theme", next);
    } catch {
      // The choice simply won't persist when storage is blocked.
    }
  }
  return <button className="icon-btn" aria-label={theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"} onClick={toggle}>{theme === "dark" ? <Moon size={21} /> : <Sun size={21} />}</button>;
}

function Notifications() {
  const pathname = usePathname();
  const { data, reload } = useData<{ notifications: Notification[] }>("/api/notifications");
  const [open, setOpen] = useState(false);
  const ref = useClickAway(() => setOpen(false));
  useEffect(() => {
    void reload();
    setOpen(false);
  }, [pathname, reload]);
  const items = data?.notifications ?? [];
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="icon-btn bell" aria-label={`التنبيهات: ${items.length}`} aria-expanded={open} onClick={() => setOpen(!open)}><Bell size={21} />{items.length > 0 && <i>{items.length}</i>}</button>
      {open && (
        <div className="pop">
          <b className="pop-title">التنبيهات</b>
          {items.length === 0 && <p className="pop-empty">لا توجد تنبيهات حالياً.</p>}
          {items.map((item) => <Link key={item.id} href={item.href} className={`pop-row tone-${item.tone}`}><span>{item.title}</span>{item.at && <small>{formatDateTime(item.at)}</small>}</Link>)}
        </div>
      )}
    </div>
  );
}

function UserMenu({ user, logout }: { user: User; logout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(() => setOpen(false));
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="user-chip" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={16} />
        <span className="user-chip-text"><b>أهلاً {user.name}</b><small>{roleLabels[user.role]}</small></span>
        <UserAvatar user={user} online />
      </button>
      {open && (
        <div className="pop pop-menu">
          <Link href="/app/settings" onClick={() => setOpen(false)}><Settings size={16} /> الإعدادات</Link>
          <button onClick={logout}><LogOut size={16} /> تسجيل الخروج</button>
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const ref = useClickAway(() => setResults(null));

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(() => {
      request<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`).then(({ results: found }) => setResults(found)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function go(href: string) {
    setQuery("");
    setResults(null);
    router.push(href);
  }

  return (
    <div className="top-search" ref={ref}>
      <form role="search" onSubmit={(event) => { event.preventDefault(); if (results?.[0]) go(results[0].href); }}>
        <Search size={19} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في القضايا، العملاء، أو المستندات..." aria-label="بحث" />
      </form>
      {results && (
        <div className="pop pop-search">
          {results.length === 0 && <p className="pop-empty">لا توجد نتائج.</p>}
          {results.map((result) => <button key={`${result.kind}-${result.id}`} className="pop-row" onClick={() => go(result.href)}><em>{result.kind}</em><span>{result.title}</span><small>{result.detail}</small></button>)}
        </div>
      )}
    </div>
  );
}
