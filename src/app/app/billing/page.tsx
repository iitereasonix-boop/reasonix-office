"use client";

import { AlertCircle, CalendarClock, ChevronDown, ChevronUp, Clock, CreditCard, Plus, Receipt, Trash2, Wallet, X } from "lucide-react";
import Link from "next/link";
import { Fragment, type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { Expense, TimeEntry } from "@/components/CaseCosts";
import { Confirm, Empty, formatDate, Loader, Modal, money, PageHead, Pill, request, send, useData } from "@/components/ui";
import { formatMinutes } from "@/lib/billing";

type Installment = { id: string; amount: number; paid: number; dueAt: string; status: "PAID" | "PARTIAL" | "OVERDUE" | "PENDING"; method: string | null; chequeNumber: string | null; chequeBank: string | null; chequeDrawer: string | null };
type Invoice = {
  id: string; number: string; amount: number; paid: number; balance: number; issuedAt: string; dueAt: string | null; notes: string | null;
  installments: Installment[]; nextInstallment: Installment | null;
  payments: { id: string; amount: number; paidAt: string; method: string | null; chequeNumber: string | null; chequeBank: string | null; chequeDrawer: string | null; chequeDueAt: string | null }[];
  legalCase: { id: string; caseNumber: string; client: { name: string } };
};
type Fees = { fees: number | null; billed: number; remaining: number | null; unbilledExpenses: number; unbilledMinutes: number };
type Row = { key: number; amount: string; dueAt: string; method: string; chequeNumber: string; chequeBank: string; chequeDrawer: string };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
const toIso = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const toDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
const cents = (value: number) => Math.round(value * 100);
let rowKey = 0;

const METHODS = ["نقداً", "شيك", "تحويل بنكي", "بطاقة", "أخرى"];
const blankRow = (amount: string, dueAt = ""): Row => ({ key: ++rowKey, amount, dueAt, method: "", chequeNumber: "", chequeBank: "", chequeDrawer: "" });

/** Splits the amount evenly in fils; the rounding remainder goes on the last installment. Dates are picked per installment. */
function buildPlan(amount: number, count: number, previous: Row[]): Row[] {
  const total = cents(amount);
  const share = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => ({
    // Dates and cheque details already entered survive a re-split.
    ...(previous[index] ?? blankRow("")),
    key: ++rowKey,
    amount: ((index === count - 1 ? total - share * (count - 1) : share) / 100).toFixed(2),
  }));
}

const STATUS: Record<Installment["status"], [string, string]> = {
  PAID: ["good", "مدفوعة"],
  PARTIAL: ["info", "مدفوعة جزئياً"],
  OVERDUE: ["bad", "متأخرة"],
  PENDING: ["neutral", "قادمة"],
};

/** Splits the amount over a number of installments; each installment's date is chosen by hand. */
function InstallmentPlanner({ amount, rows, setRows }: { amount: number; rows: Row[]; setRows: (rows: Row[]) => void }) {
  const [count, setCount] = useState(rows.length || 3);
  const total = rows.reduce((sum, row) => sum + cents(Number(row.amount) || 0), 0);
  const diff = cents(amount) - total;
  const update = (key: number, patch: Partial<Row>) => setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <div className="plan wide">
      <div className="plan-gen">
        <label><span>عدد الدفعات</span><input type="number" min={2} max={60} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>
        <button type="button" className="btn btn-ghost" disabled={!amount || count < 2 || count > 60} onClick={() => setRows(buildPlan(amount, count, rows))}>توزيع المبلغ</button>
      </div>
      {rows.length > 0 && (
        <>
          <ol className="plan-rows">
            {rows.map((row, index) => (
              <li key={row.key}>
                <b>الدفعة {index + 1}</b>
                <input aria-label={`مبلغ الدفعة ${index + 1}`} type="number" min={0} step="any" value={row.amount} onChange={(event) => update(row.key, { amount: event.target.value })} />
                <input aria-label={`تاريخ الدفعة ${index + 1}`} title={row.method === "شيك" ? "تاريخ استحقاق الشيك" : "تاريخ الاستحقاق"} type="date" required value={row.dueAt} onChange={(event) => update(row.key, { dueAt: event.target.value })} />
                <select aria-label={`طريقة دفع الدفعة ${index + 1}`} value={row.method} onChange={(event) => update(row.key, { method: event.target.value })}>
                  <option value="">طريقة الدفع</option>
                  {METHODS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <button type="button" className="icon-btn" aria-label={`حذف الدفعة ${index + 1}`} disabled={rows.length <= 2} onClick={() => setRows(rows.filter((item) => item.key !== row.key))}><X size={15} /></button>
                {row.method === "شيك" && (
                  <div className="plan-cheque">
                    <input aria-label={`رقم شيك الدفعة ${index + 1}`} placeholder="رقم الشيك *" dir="auto" required value={row.chequeNumber} onChange={(event) => update(row.key, { chequeNumber: event.target.value })} />
                    <input aria-label={`بنك شيك الدفعة ${index + 1}`} placeholder="البنك *" required value={row.chequeBank} onChange={(event) => update(row.key, { chequeBank: event.target.value })} />
                    <input aria-label={`ساحب شيك الدفعة ${index + 1}`} placeholder="اسم الساحب" value={row.chequeDrawer} onChange={(event) => update(row.key, { chequeDrawer: event.target.value })} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="plan-foot">
            <span className="plan-foot-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRows([...rows, blankRow(diff > 0 ? (diff / 100).toFixed(2) : "0")])}><Plus size={15} /> دفعة</button>
              <button type="button" className="btn btn-ghost" title="تحويل كل الدفعات إلى شيكات، ونسخ البنك والساحب من أول شيك" onClick={() => {
                const first = rows.find((row) => row.method === "شيك" && row.chequeBank) ?? rows[0];
                setRows(rows.map((row) => ({ ...row, method: "شيك", chequeBank: row.chequeBank || first.chequeBank, chequeDrawer: row.chequeDrawer || first.chequeDrawer })));
              }}>كلها شيكات</button>
            </span>
            {diff === 0 ? <Pill tone="good">المجموع مطابق: {money(total / 100)}</Pill> : <Pill tone="warn">{diff > 0 ? `متبقٍ للتوزيع ${money(diff / 100)}` : `زيادة ${money(-diff / 100)}`}</Pill>}
          </div>
        </>
      )}
    </div>
  );
}

const planPayload = (rows: Row[]) => rows.map((row) => ({
  amount: Number(row.amount),
  dueAt: toIso(row.dueAt),
  method: row.method || undefined,
  ...(row.method === "شيك" ? { chequeNumber: row.chequeNumber.trim(), chequeBank: row.chequeBank.trim(), chequeDrawer: row.chequeDrawer.trim() || undefined } : {}),
}));
const planError = (rows: Row[], amount: number) => {
  if (rows.length < 2) return "اضغط «توزيع المبلغ» لإنشاء دفعتين على الأقل.";
  if (rows.some((row) => !(Number(row.amount) > 0))) return "لكل دفعة مبلغ أكبر من صفر.";
  if (rows.some((row) => !row.dueAt)) return "اختر تاريخ استحقاق لكل دفعة.";
  if (rows.some((row) => row.method === "شيك" && (!row.chequeNumber.trim() || !row.chequeBank.trim()))) return "أدخل رقم الشيك والبنك لكل دفعة بشيك.";
  if (rows.reduce((sum, row) => sum + cents(Number(row.amount)), 0) !== cents(amount)) return "مجموع الدفعات يجب أن يساوي مبلغ الفاتورة.";
  return "";
};

function InvoiceModal({ cases, onClose, onSaved }: { cases: { id: string; caseNumber: string; title: string }[]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [caseId, setCaseId] = useState("");
  const [fees, setFees] = useState<Fees | null>(null);
  const [amount, setAmount] = useState("");
  const [number, setNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState(today());
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [split, setSplit] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [withExpenses, setWithExpenses] = useState(false);
  const [rate, setRate] = useState("");
  const rateValue = Number(rate) > 0 ? Number(rate) : 0;
  // Same rounding as the server: hours are priced in fils.
  const extras = fees
    ? (withExpenses ? cents(fees.unbilledExpenses) : 0) + (rateValue ? Math.round((fees.unbilledMinutes * Math.round(rateValue * 100)) / 60) : 0)
    : 0;
  const total = (cents(Number(amount) || 0) + extras) / 100;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The amount follows the case's agreed fees, minus what earlier invoices already billed.
  useEffect(() => {
    setFees(null);
    if (!caseId) return;
    let live = true;
    request<Fees>(`/api/invoices?fees=${caseId}`).then((result) => {
      if (!live) return;
      setFees(result);
      setAmount(result.remaining ? String(result.remaining) : "");
      setRows([]);
      setWithExpenses(false);
      setRate("");
    }).catch(() => undefined);
    return () => { live = false; };
  }, [caseId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(amount) || 0;
    const problem = !(total > 0) ? "أدخل مبلغ الفاتورة." : split ? planError(rows, total) : "";
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      await send("/api/invoices", "POST", {
        caseId,
        amount: value,
        includeExpenses: withExpenses || undefined,
        hourlyRate: rateValue || undefined,
        number: number.trim() || undefined,
        issuedAt: toIso(issuedAt),
        dueAt: !split && dueAt ? toIso(dueAt) : undefined,
        notes: notes.trim() || undefined,
        installments: split ? planPayload(rows) : undefined,
      });
      await onSaved();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر الحفظ.");
      setBusy(false);
    }
  }

  return (
    <Modal title="فاتورة جديدة" wide onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label className="wide"><span>القضية *</span>
          <select required value={caseId} onChange={(event) => setCaseId(event.target.value)}>
            <option value="">اختر...</option>
            {cases.map((item) => <option key={item.id} value={item.id}>{item.caseNumber} — {item.title}</option>)}
          </select>
        </label>
        {fees && (
          <p className="form-note wide">
            {fees.fees === null
              ? "لا توجد أتعاب مسجلة في هذه القضية. أدخل المبلغ يدوياً، أو سجّل الأتعاب من صفحة القضية."
              : <>أتعاب القضية {money(fees.fees)} · مفوتر سابقاً {money(fees.billed)} · <b>المتبقي {money(fees.remaining ?? 0)}</b></>}
          </p>
        )}
        <label><span>{fees && (fees.unbilledExpenses > 0 || fees.unbilledMinutes > 0) ? "الأتعاب بالدينار" : "المبلغ بالدينار *"}</span><input type="number" min={0} step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setRows([]); }} /></label>
        {fees && fees.unbilledExpenses > 0 && (
          <label className="check wide"><input type="checkbox" checked={withExpenses} onChange={(event) => { setWithExpenses(event.target.checked); setRows([]); }} /><span>إضافة المصاريف غير المفوترة ({money(fees.unbilledExpenses)})</span></label>
        )}
        {fees && fees.unbilledMinutes > 0 && (
          <label><span>سعر الساعة لإضافة {formatMinutes(fees.unbilledMinutes)} غير مفوترة</span><input type="number" min={0} step="any" placeholder="اتركه فارغاً لعدم إضافتها" value={rate} onChange={(event) => { setRate(event.target.value); setRows([]); }} /></label>
        )}
        {extras > 0 && <p className="form-note wide">مجموع الفاتورة: <b>{money(total)}</b> (أتعاب {money(Number(amount) || 0)} + مصاريف وساعات {money(extras / 100)})</p>}
        <label><span>رقم الفاتورة</span><input value={number} placeholder="يُولَّد تلقائياً" onChange={(event) => setNumber(event.target.value)} /></label>
        <label><span>تاريخ الإصدار *</span><input type="date" required value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} /></label>
        <div className="wide tabs" role="radiogroup" aria-label="طريقة السداد">
          <button type="button" role="radio" aria-checked={!split} className={!split ? "active" : ""} onClick={() => setSplit(false)}>دفعة واحدة</button>
          <button type="button" role="radio" aria-checked={split} className={split ? "active" : ""} onClick={() => setSplit(true)}><CalendarClock size={15} /> تقسيط على دفعات</button>
        </div>
        {split
          ? <InstallmentPlanner amount={total} rows={rows} setRows={setRows} />
          : <label><span>تاريخ الاستحقاق</span><input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>}
        <label className="wide"><span>ملاحظات</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        {error && <div className="notice notice-error wide"><AlertCircle size={16} />{error}</div>}
        <div className="form-actions wide">
          <button type="button" className="btn btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold" disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ الفاتورة"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const next = invoice.nextInstallment;
  // The installment being paid may already carry its method and cheque.
  const [method, setMethod] = useState(next?.method || "نقداً");
  const planned = next?.method === "شيك" ? next : null;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cheque = method === "شيك";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    setBusy(true);
    setError("");
    try {
      await send(`/api/invoices?payment=${invoice.id}`, "POST", {
        amount: Number(form.get("amount")),
        paidAt: toIso(String(form.get("paidAt"))),
        method,
        ...(cheque ? {
          chequeNumber: text("chequeNumber"),
          chequeBank: text("chequeBank"),
          chequeDrawer: text("chequeDrawer"),
          chequeDueAt: toIso(String(form.get("chequeDueAt"))),
        } : {}),
      });
      await onSaved();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر الحفظ.");
      setBusy(false);
    }
  }

  return (
    <Modal title={`دفعة على الفاتورة ${invoice.number}`} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label><span>المبلغ *</span><input name="amount" type="number" min={0} step="any" required defaultValue={String(Number((next ? next.amount - next.paid : invoice.balance).toFixed(2)))} /></label>
        <label><span>تاريخ الاستلام *</span><input name="paidAt" type="date" required defaultValue={today()} /></label>
        <div className="wide tabs pay-methods" role="radiogroup" aria-label="طريقة الدفع">
          {METHODS.map((item) => <button key={item} type="button" role="radio" aria-checked={method === item} className={method === item ? "active" : ""} onClick={() => setMethod(item)}>{item}</button>)}
        </div>
        {cheque && (
          <>
            <label><span>رقم الشيك *</span><input name="chequeNumber" required dir="auto" defaultValue={planned?.chequeNumber ?? ""} /></label>
            <label><span>البنك *</span><input name="chequeBank" required defaultValue={planned?.chequeBank ?? ""} /></label>
            <label><span>تاريخ استحقاق الشيك *</span><input name="chequeDueAt" type="date" required defaultValue={planned ? toDay(planned.dueAt) : today()} /></label>
            <label><span>اسم الساحب</span><input name="chequeDrawer" defaultValue={planned?.chequeDrawer ?? ""} /></label>
          </>
        )}
        {error && <div className="notice notice-error wide"><AlertCircle size={16} />{error}</div>}
        <div className="form-actions wide">
          <button type="button" className="btn btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold" disabled={busy}>{busy ? "جارٍ الحفظ..." : "تسجيل الدفعة"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ScheduleModal({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [rows, setRows] = useState<Row[]>(invoice.installments.map((row) => ({ ...blankRow(row.amount.toFixed(2), toDay(row.dueAt)), method: row.method ?? "", chequeNumber: row.chequeNumber ?? "", chequeBank: row.chequeBank ?? "", chequeDrawer: row.chequeDrawer ?? "" })));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(plan: Row[]) {
    const problem = plan.length ? planError(plan, invoice.amount) : "";
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await send(`/api/invoices?id=${invoice.id}`, "PUT", { installments: planPayload(plan) });
      await onSaved();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "تعذر الحفظ.");
      setBusy(false);
    }
  }
  return (
    <Modal title={`دفعات الفاتورة ${invoice.number}`} wide onClose={onClose}>
      <div className="form-grid">
        <p className="form-note wide">مبلغ الفاتورة {money(invoice.amount)} · المدفوع {money(invoice.paid)}. تُخصم المدفوعات من أقدم دفعة أولاً.</p>
        <InstallmentPlanner amount={invoice.amount} rows={rows} setRows={setRows} />
        {error && <div className="notice notice-error wide"><AlertCircle size={16} />{error}</div>}
        <div className="form-actions wide">
          {invoice.installments.length > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => save([])}>إلغاء التقسيط</button>}
          <button type="button" className="btn btn-ghost" onClick={onClose}>إغلاق</button>
          <button type="button" className="btn btn-gold" disabled={busy} onClick={() => save(rows)}>{busy ? "جارٍ الحفظ..." : "حفظ الدفعات"}</button>
        </div>
      </div>
    </Modal>
  );
}

function ExpensesTab() {
  const { data, error, reload } = useData<{ expenses: Expense[] }>("/api/expenses");
  if (!data) return <Loader error={error} retry={reload} />;
  const total = data.expenses.reduce((sum, row) => sum + row.amount, 0);
  const unbilled = data.expenses.filter((row) => row.billable && !row.invoiceNumber).reduce((sum, row) => sum + row.amount, 0);
  const office = data.expenses.filter((row) => !row.billable).reduce((sum, row) => sum + row.amount, 0);
  return (
    <>
      <section className="stats">
        <div className="stat"><div><b>{money(total)}</b><small>كل المصاريف</small></div></div>
        <div className="stat"><div><b>{money(unbilled)}</b><small>بانتظار الفوترة</small></div></div>
        <div className="stat"><div><b>{money(office)}</b><small>على المكتب</small></div></div>
      </section>
      <section className="card">
        {data.expenses.length === 0 ? <Empty title="لا توجد مصاريف" hint="تُسجَّل المصاريف من صفحة كل قضية." icon={<Wallet size={28} />} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>التاريخ</th><th>القضية</th><th>النوع</th><th>المبلغ</th><th>الفوترة</th></tr></thead>
            <tbody>{data.expenses.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.spentAt)}<small>{row.createdBy.name}</small></td>
                <td><Link href={`/app/cases/${row.legalCase.id}`}><b>{row.legalCase.caseNumber}</b><small>{row.legalCase.client.name}</small></Link></td>
                <td>{row.category}{row.description && <small>{row.description}</small>}</td>
                <td>{money(row.amount)}</td>
                <td>{row.invoiceNumber ? <Pill tone="good">{row.invoiceNumber}</Pill> : !row.billable ? <Pill>على المكتب</Pill> : <Pill tone="warn">غير مفوتر</Pill>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

function TimeTab() {
  const { data, error, reload } = useData<{ entries: TimeEntry[] }>("/api/time");
  if (!data) return <Loader error={error} retry={reload} />;
  const total = data.entries.reduce((sum, row) => sum + row.minutes, 0);
  const unbilled = data.entries.filter((row) => row.billable && !row.invoiceNumber).reduce((sum, row) => sum + row.minutes, 0);
  const byPerson = new Map<string, number>();
  for (const row of data.entries) byPerson.set(row.user.name, (byPerson.get(row.user.name) ?? 0) + row.minutes);
  return (
    <>
      <section className="stats">
        <div className="stat"><div><b>{formatMinutes(total)}</b><small>كل الساعات</small></div></div>
        <div className="stat"><div><b>{formatMinutes(unbilled)}</b><small>بانتظار الفوترة</small></div></div>
        {[...byPerson].slice(0, 2).map(([name, minutes]) => <div key={name} className="stat"><div><b>{formatMinutes(minutes)}</b><small>{name}</small></div></div>)}
      </section>
      <section className="card">
        {data.entries.length === 0 ? <Empty title="لا توجد ساعات مسجلة" hint="يسجّل كل موظف وقته من صفحة القضية." icon={<Clock size={28} />} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>التاريخ</th><th>القضية</th><th>العمل</th><th>المدة</th><th>الفوترة</th></tr></thead>
            <tbody>{data.entries.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.workedAt)}<small>{row.user.name}</small></td>
                <td><Link href={`/app/cases/${row.legalCase.id}`}><b>{row.legalCase.caseNumber}</b><small>{row.legalCase.client.name}</small></Link></td>
                <td>{row.description}</td>
                <td>{formatMinutes(row.minutes)}</td>
                <td>{row.invoiceNumber ? <Pill tone="good">{row.invoiceNumber}</Pill> : !row.billable ? <Pill>غير قابلة للفوترة</Pill> : <Pill tone="warn">غير مفوترة</Pill>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

const TABS = [["invoices", "الفواتير"], ["expenses", "المصاريف"], ["time", "ساعات العمل"]] as const;

export default function BillingPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("invoices");
  const tabs = (
    <div className="tabs" role="tablist" aria-label="أقسام الأتعاب">
      {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}
    </div>
  );
  if (tab !== "invoices") {
    return (
      <>
        <PageHead title="الأتعاب والفواتير" subtitle="الفواتير والمصاريف وساعات العمل." />
        {tabs}
        {tab === "expenses" ? <ExpensesTab /> : <TimeTab />}
      </>
    );
  }
  return <Invoices tabs={tabs} />;
}

function Invoices({ tabs }: { tabs: ReactNode }) {
  const { data, error, reload } = useData<{ invoices: Invoice[] }>("/api/invoices");
  const { data: cases } = useData<{ cases: { id: string; caseNumber: string; title: string }[] }>("/api/cases");
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [scheduling, setScheduling] = useState<Invoice | null>(null);
  const [removing, setRemoving] = useState<Invoice | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <Loader error={error} retry={reload} />;
  const billed = data.invoices.reduce((sum, row) => sum + row.amount, 0);
  const paid = data.invoices.reduce((sum, row) => sum + row.paid, 0);
  const overdue = data.invoices.flatMap((row) => row.installments).filter((row) => row.status === "OVERDUE").reduce((sum, row) => sum + row.amount - row.paid, 0);

  return (
    <>
      <PageHead title="الأتعاب والفواتير" subtitle="الفواتير والمصاريف وساعات العمل." action={<button className="btn btn-gold" onClick={() => setCreating(true)}><Plus size={17} /> فاتورة جديدة</button>} />
      {tabs}
      <section className="stats">
        <div className="stat"><div><b>{money(billed)}</b><small>المفوتر</small></div></div>
        <div className="stat"><div><b>{money(paid)}</b><small>المدفوع</small></div></div>
        <div className="stat"><div><b>{money(billed - paid)}</b><small>المستحق</small></div></div>
        <div className="stat"><div><b>{money(overdue)}</b><small>دفعات متأخرة</small></div></div>
      </section>
      <section className="card">
        {data.invoices.length === 0 ? <Empty title="لا توجد فواتير" icon={<Receipt size={28} />} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>الفاتورة</th><th>القضية</th><th>المبلغ</th><th>المدفوع</th><th>المستحق</th><th>الدفعة القادمة</th><th aria-label="إجراءات" /></tr></thead>
            <tbody>{data.invoices.map((invoice) => {
              const next = invoice.nextInstallment;
              const expanded = open === invoice.id;
              return (
                <Fragment key={invoice.id}>
                  <tr>
                    <td><b>{invoice.number}</b><small>{formatDate(invoice.issuedAt)}{invoice.installments.length ? ` · ${invoice.installments.length} دفعات` : ""}</small></td>
                    <td><Link href={`/app/cases/${invoice.legalCase.id}`}><b>{invoice.legalCase.caseNumber}</b><small>{invoice.legalCase.client.name}</small></Link></td>
                    <td>{money(invoice.amount)}</td>
                    <td>{money(invoice.paid)}</td>
                    <td>{invoice.balance > 0 ? <Pill tone="warn">{money(invoice.balance)}</Pill> : <Pill tone="good">مسددة</Pill>}</td>
                    <td>{next
                      ? <><Pill tone={STATUS[next.status][0]}>{formatDate(next.dueAt)}</Pill><small>{money(next.amount - next.paid)}</small></>
                      : invoice.balance > 0 && invoice.dueAt ? formatDate(invoice.dueAt) : "—"}</td>
                    <td className="row-actions">
                      {(invoice.installments.length > 0 || invoice.payments.length > 0) && (
                        <button className="icon-btn" aria-label={`تفاصيل ${invoice.number}`} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : invoice.id)}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                      )}
                      {invoice.balance > 0 && <button className="icon-btn" aria-label={`تقسيط ${invoice.number}`} title="جدولة الدفعات" onClick={() => setScheduling(invoice)}><CalendarClock size={16} /></button>}
                      {invoice.balance > 0 && <button className="icon-btn" aria-label={`تسجيل دفعة ${invoice.number}`} title="تسجيل دفعة" onClick={() => setPaying(invoice)}><CreditCard size={16} /></button>}
                      <button className="icon-btn" aria-label={`حذف ${invoice.number}`} onClick={() => setRemoving(invoice)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="invoice-detail">
                      <td colSpan={7}>
                        {invoice.installments.length > 0 && (
                          <ul className="rows">{invoice.installments.map((row, index) => (
                            <li key={row.id}>
                              <span>الدفعة {index + 1} · {money(row.amount)}{row.method ? ` · ${row.method}` : ""}<small>تستحق {formatDate(row.dueAt)}{row.status === "PARTIAL" || (row.status === "OVERDUE" && row.paid > 0) ? ` · مدفوع ${money(row.paid)}` : ""}</small>
                                {row.chequeNumber && <small>شيك رقم <bdi>{row.chequeNumber}</bdi> · {row.chequeBank}{row.chequeDrawer ? ` · الساحب ${row.chequeDrawer}` : ""}</small>}
                              </span>
                              <Pill tone={STATUS[row.status][0]}>{STATUS[row.status][1]}</Pill>
                            </li>
                          ))}</ul>
                        )}
                        {invoice.payments.length > 0 && (
                          <ul className="rows">{invoice.payments.map((payment) => (
                            <li key={payment.id}>
                              <span>دفعة مستلمة · {money(payment.amount)}<small>{formatDate(payment.paidAt)}{payment.method ? ` · ${payment.method}` : ""}</small>
                                {payment.chequeNumber && <small>شيك رقم <bdi>{payment.chequeNumber}</bdi> · {payment.chequeBank}{payment.chequeDrawer ? ` · الساحب ${payment.chequeDrawer}` : ""}{payment.chequeDueAt ? ` · يستحق ${formatDate(payment.chequeDueAt)}` : ""}</small>}
                              </span>
                              {payment.chequeDueAt && new Date(payment.chequeDueAt).getTime() > Date.now() && <Pill tone="warn">شيك مؤجل</Pill>}
                            </li>
                          ))}</ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
      {creating && <InvoiceModal cases={cases?.cases ?? []} onClose={() => setCreating(false)} onSaved={reload} />}
      {scheduling && <ScheduleModal invoice={scheduling} onClose={() => setScheduling(null)} onSaved={reload} />}
      {paying && <PaymentModal invoice={paying} onClose={() => setPaying(null)} onSaved={reload} />}
      {removing && <Confirm title="حذف الفاتورة" body={`حذف الفاتورة ${removing.number}؟ يمكن استرجاعها من الإعدادات.`} action="حذف" danger onClose={() => setRemoving(null)} onConfirm={async () => { await send(`/api/invoices?id=${removing.id}`, "DELETE"); await reload(); }} />}
    </>
  );
}
