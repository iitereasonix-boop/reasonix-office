"use client";

import {
  ArrowLeft, BarChart3, Bot, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, FileText, Hourglass, MessageCircle, Scale, Search, Send, Sparkles, Activity, UsersRound,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { useUser } from "@/components/AppShell";
import { typeColor } from "@/components/case-status";
import { Donut } from "@/components/charts";
import { caseTypes, courts, dayKey, Empty, formatDate, formatDateTime, formatTime, Loader, Pill, timeAgo, useData } from "@/components/ui";

type Overview = {
  counts: { clients: number; cases: number; drafts: number; legalDrafts: number; hearings: number; today: number; appeals: number };
  todayHearings: { id: string; startsAt: string; purpose: string | null; legalCase: { id: string; caseNumber: string; court: string; client: { name: string } } }[];
  byType: { type: string; count: number }[];
  activity: { id: string; label: string; caseNumber: string | null; caseId: string | null; createdAt: string }[];
  weekHearings: { id: string; startsAt: string; purpose: string | null; legalCase: { id: string; caseNumber: string; client: { name: string } } }[];
  upcomingAppeals: { id: string; title: string; appealDeadline: string; legalCase: { id: string; caseNumber: string } }[];
  staleCases: { id: string; caseNumber: string; title: string; updatedAt: string }[];
  staleDays: number;
};

export default function Dashboard() {
  const user = useUser();
  const [months, setMonths] = useState(6);
  const { data, error, reload } = useData<Overview>(`/api/overview?months=${months}`);
  if (!data) return <Loader error={error} retry={reload} />;
  const { counts } = data;
  const slices = data.byType.map(({ type, count }) => ({ key: type, label: caseTypes[type], value: count }));

  return (
    <>
      <div className="dash">
        <div className="dash-head">
          <section className="banner" aria-hidden="true" />
          <section className="stats">
            <div className="stat stat-welcome"><span className="stat-icon"><UsersRound /></span><div><h1>مرحباً بك في نظام ريزونكس</h1><small>معاً نحو إدارة قانونية أكثر كفاءة واحترافية</small></div></div>
            <Stat href="/app/cases" icon={<Scale />} value={counts.cases} label="إجمالي القضايا" />
            <Stat href={`/app/hearings?date=${dayKey(new Date())}`} icon={<CalendarDays />} value={counts.today} label="جلسات اليوم" />
            <Stat href="/app/judgments" icon={<FileText />} value={counts.appeals} label="مواعيد طعن قريبة" />
          </section>
        </div>

        <AssistantWidget />

        <div className="dash-mid">
          <MonthCalendar />
          <section className="card">
            <header className="card-head"><h2><CalendarDays size={20} /> جلسات اليوم</h2><Link href="/app/hearings" className="link-btn"><ArrowLeft size={15} /> عرض الكل</Link></header>
            {data.todayHearings.length === 0 ? <Empty title="لا توجد جلسات اليوم" /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>الوقت</th><th>رقم الدعوى</th><th>العميل</th><th>المحكمة</th><th>الغرض</th><th>الحالة</th></tr></thead>
                <tbody>{data.todayHearings.map((hearing) => (
                  <tr key={hearing.id}>
                    <td>{formatTime(hearing.startsAt)}</td>
                    <td><Link href={`/app/cases/${hearing.legalCase.id}`}>{hearing.legalCase.caseNumber}</Link></td>
                    <td>{hearing.legalCase.client.name}</td>
                    <td>{courts[hearing.legalCase.court]}</td>
                    <td>{hearing.purpose ?? "—"}</td>
                    <td><Pill tone="good">مجدولة</Pill></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </div>

        <div className="dash-bottom">
          <section className="card ai-card">
            <h2><Sparkles size={18} /> مساعد القضية الذكي</h2>
            <p>تلخيص القضية، والإجابة على استفساراتك، مع الإشارة إلى المصدر.</p>
            <Link href="/app/assistant" className="btn btn-gold"><Bot size={18} /> بدء المساعدة</Link>
          </section>
          <section className="card">
            <header className="card-head">
              <h2><BarChart3 size={20} /> إحصائيات سريعة</h2>
              <select className="mini-select" aria-label="الفترة" value={months} onChange={(event) => setMonths(Number(event.target.value))}>
                <option value={3}>آخر 3 أشهر</option><option value={6}>آخر 6 أشهر</option><option value={12}>آخر 12 شهراً</option>
              </select>
            </header>
            {slices.length ? <Donut slices={slices} unit="قضية" colorOf={typeColor} /> : <Empty title="لا توجد قضايا في هذه الفترة" />}
          </section>
          <section className="card">
            <header className="card-head"><h2><Activity size={20} /> أحدث النشاطات</h2><Link href="/app/reports" className="link-btn"><ArrowLeft size={15} /> عرض الكل</Link></header>
            {data.activity.length === 0 ? <Empty title="لا توجد نشاطات بعد" /> : (
              <ul className="activity">{data.activity.map((item) => (
                <li key={item.id}>
                  {item.caseId ? <Link href={`/app/cases/${item.caseId}`}>{item.label}{item.caseNumber ? ` — ${item.caseNumber}` : ""}</Link> : <span>{item.label}</span>}
                  <small>{timeAgo(item.createdAt)}</small>
                </li>
              ))}</ul>
            )}
          </section>
        </div>

        <div className="dash-extra">
          <section className="card">
            <header className="card-head"><h2><CalendarClock size={18} /> مواعيد الطعن القريبة</h2></header>
            {data.upcomingAppeals.length === 0 ? <Empty title="لا توجد مواعيد قريبة" /> : (
              <ul className="rows">{data.upcomingAppeals.map((item) => <li key={item.id}><Link href="/app/judgments">{item.title}<small>{item.legalCase.caseNumber} · {formatDate(item.appealDeadline)}</small></Link></li>)}</ul>
            )}
          </section>
          <section className="card">
            <header className="card-head"><h2><CalendarDays size={18} /> جلسات الأسبوع</h2></header>
            {data.weekHearings.length === 0 ? <Empty title="لا توجد جلسات هذا الأسبوع" /> : (
              <ul className="rows">{data.weekHearings.map((item) => <li key={item.id}><Link href={`/app/cases/${item.legalCase.id}`}>{item.legalCase.caseNumber} — {item.legalCase.client.name}<small>{formatDateTime(item.startsAt)}</small></Link></li>)}</ul>
            )}
          </section>
          <section className="card">
            <header className="card-head"><h2><Hourglass size={18} /> قضايا بلا تحديث منذ {data.staleDays} يوماً</h2></header>
            {data.staleCases.length === 0 ? <Empty title="كل القضايا محدّثة" /> : (
              <ul className="rows">{data.staleCases.map((item) => <li key={item.id}><Link href={`/app/cases/${item.id}`}>{item.caseNumber}<small>{item.title} · آخر تحديث {formatDate(item.updatedAt)}</small></Link></li>)}</ul>
            )}
          </section>
        </div>
      </div>
      {user.role === "SENIOR_LAWYER" && counts.drafts > 0 && (
        <Link href="/app/whatsapp" className="notice notice-gold"><MessageCircle size={17} /> {counts.drafts} رسالة واتساب بانتظار اعتمادك</Link>
      )}
    </>
  );
}

function Stat({ href, icon, value, label }: { href: string; icon: React.ReactNode; value: number; label: string }) {
  return <Link href={href} className="stat"><span className="stat-icon">{icon}</span><div><b>{value}</b><small>{label}</small></div></Link>;
}

function AssistantWidget() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const { data } = useData<{ cases: { caseNumber: string }[] }>("/api/cases");
  const latest = data?.cases[0]?.caseNumber;
  const ask = (text: string) => router.push(`/app/assistant?q=${encodeURIComponent(text)}`);
  const quick = [
    { icon: <FileText size={16} />, label: latest ? `تلخيص قضية رقم ${latest}` : "تلخيص قضية", text: latest ? `لخّص لي القضية ${latest}، واحكيلي شو آخر قرار وشو لازم أجهز للجلسة القادمة.` : "ساعدني في تلخيص قضية" },
    { icon: <CalendarDays size={16} />, label: "موعد الجلسة القادمة", text: "ما هي الجلسات القادمة خلال الأسبوعين القادمين؟" },
    { icon: <MessageCircle size={16} />, label: "إرسال تذكير للعميل", text: latest ? `جهّز مسودة واتساب تذكّر عميل القضية ${latest} بموعد الجلسة القادمة.` : "جهّز مسودة تذكير للعميل بموعد جلسته" },
  ];
  function submit(event: FormEvent) {
    event.preventDefault();
    if (question.trim()) ask(question.trim());
  }
  return (
    <section className="card assistant-widget">
      <Image className="robot-panel" src="/images/robot-panel.jpg" alt="مساعد ريزونكس يسأل: كيف يمكنني مساعدتك اليوم؟" width={322} height={296} priority />
      {quick.map((item) => <button key={item.label} className="quick" onClick={() => ask(item.text)}>{item.icon}<span>{item.label}</span></button>)}
      <Link href="/app/clients" className="quick"><Search size={16} /><span>البحث عن عميل</span></Link>
      <form className="ask" onSubmit={submit}>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="اكتب سؤالك هنا..." aria-label="سؤالك" />
        <button className="send-btn" aria-label="إرسال"><Send size={17} /></button>
      </form>
    </section>
  );
}

const WEEK = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

function MonthCalendar() {
  const [shown, setShown] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const next = new Date(shown.getFullYear(), shown.getMonth() + 1, 1);
  const { data } = useData<{ hearings: { startsAt: string }[] }>(`/api/hearings?from=${shown.toISOString()}&to=${next.toISOString()}`);
  const busy = useMemo(() => new Set(data?.hearings.map((hearing) => dayKey(hearing.startsAt))), [data]);
  const today = dayKey(new Date());
  const lead = (shown.getDay() + 1) % 7; // Weeks start on Saturday, as on Jordanian calendars.
  const count = new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate();
  const keyOf = (day: number) => `${shown.getFullYear()}-${String(shown.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return (
    <section className="card calendar">
      <header>
        <button className="icon-btn" aria-label="الشهر السابق" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))}><ChevronRight size={18} /></button>
        <b>{new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric", numberingSystem: "latn" }).format(shown)}</b>
        <button className="icon-btn" aria-label="الشهر التالي" onClick={() => setShown(next)}><ChevronLeft size={18} /></button>
      </header>
      <div className="cal-grid">
        {WEEK.map((name) => <small key={name}>{name}</small>)}
        {Array.from({ length: lead }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: count }, (_, index) => {
          const key = keyOf(index + 1);
          return <Link key={key} href={`/app/hearings?date=${key}`} className={`${key === today ? "today" : ""} ${busy.has(key) ? "busy" : ""}`} aria-label={`${key}${busy.has(key) ? "، توجد جلسات" : ""}`}>{index + 1}</Link>;
        })}
      </div>
    </section>
  );
}
