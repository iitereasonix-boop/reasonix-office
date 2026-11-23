"use client";

import { Clock, Plus, Trash2, Wallet } from "lucide-react";
import { useState } from "react";
import { useUser } from "@/components/AppShell";
import { Confirm, Empty, formatDate, FormModal, Loader, money, Pill, send, useData, type Field } from "@/components/ui";
import { EXPENSE_CATEGORIES, formatMinutes } from "@/lib/billing";

export type Expense = {
  id: string; amount: number; spentAt: string; category: string; description: string | null; billable: boolean;
  invoiceNumber: string | null; createdById: string; createdBy: { name: string };
  legalCase: { id: string; caseNumber: string; client: { name: string } };
};
export type TimeEntry = {
  id: string; minutes: number; workedAt: string; description: string; billable: boolean;
  invoiceNumber: string | null; userId: string; user: { name: string };
  legalCase: { id: string; caseNumber: string; client: { name: string } };
};

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
const billableOptions: [string, string][] = [["yes", "نعم، تُحمَّل على العميل"], ["no", "لا، على المكتب"]];

export const expenseFields: Field[] = [
  { name: "amount", label: "المبلغ بالدينار", type: "number", required: true },
  { name: "spentAt", label: "التاريخ", type: "date", required: true, defaultValue: today() },
  { name: "category", label: "النوع", type: "select", required: true, defaultValue: EXPENSE_CATEGORIES[0], options: EXPENSE_CATEGORIES.map((item) => [item, item]) },
  { name: "billable", label: "تُفوتر للعميل؟", type: "select", required: true, defaultValue: "yes", options: billableOptions },
  { name: "description", label: "تفاصيل", type: "textarea", rows: 2 },
];

export const timeFields: Field[] = [
  { name: "hours", label: "ساعات", type: "number", placeholder: "0" },
  { name: "mins", label: "دقائق", type: "number", placeholder: "0" },
  { name: "workedAt", label: "التاريخ", type: "date", required: true, defaultValue: today() },
  { name: "billable", label: "تُفوتر للعميل؟", type: "select", required: true, defaultValue: "yes", options: billableOptions },
  { name: "description", label: "ما الذي أُنجز", type: "textarea", required: true, rows: 2 },
];

export async function saveExpense(caseId: string, values: Record<string, unknown>) {
  await send("/api/expenses", "POST", { ...values, caseId, billable: values.billable !== "no" });
}

export async function saveTime(caseId: string, values: Record<string, unknown>) {
  const minutes = Math.round(Number(values.hours ?? 0) * 60 + Number(values.mins ?? 0));
  if (!(minutes > 0)) throw new Error("أدخل مدة العمل بالساعات أو الدقائق.");
  await send("/api/time", "POST", { caseId, minutes, workedAt: values.workedAt, description: values.description, billable: values.billable !== "no" });
}

/** A case's expenses and logged hours. Expenses are office-only; everyone logs their own hours. */
export function CaseCosts({ caseId }: { caseId: string }) {
  const user = useUser();
  const office = user.role === "SENIOR_LAWYER" || user.role === "SECRETARY";
  const senior = user.role === "SENIOR_LAWYER";
  const expenses = useData<{ expenses: Expense[] }>(office ? `/api/expenses?caseId=${caseId}` : null);
  const time = useData<{ entries: TimeEntry[] }>(`/api/time?caseId=${caseId}`);
  const [modal, setModal] = useState<"" | "expense" | "time">("");
  const [removing, setRemoving] = useState<{ kind: "expense" | "time"; id: string; label: string } | null>(null);

  const expenseRows = expenses.data?.expenses ?? [];
  const timeRows = time.data?.entries ?? [];
  const expenseTotal = expenseRows.reduce((sum, row) => sum + row.amount, 0);
  const unbilledExpenses = expenseRows.filter((row) => row.billable && !row.invoiceNumber).reduce((sum, row) => sum + row.amount, 0);
  const minutes = timeRows.reduce((sum, row) => sum + row.minutes, 0);
  const unbilledMinutes = timeRows.filter((row) => row.billable && !row.invoiceNumber).reduce((sum, row) => sum + row.minutes, 0);

  return (
    <>
      {office && (
        <section className="card">
          <header className="card-head"><h2><Wallet size={18} /> المصاريف</h2><button className="link-btn" onClick={() => setModal("expense")}><Plus size={15} /> مصروف</button></header>
          {expenseRows.length > 0 && (
            <dl className="money-facts">
              <div><dt>مجموع المصاريف</dt><dd>{money(expenseTotal)}</dd></div>
              <div><dt>غير مفوترة</dt><dd>{money(unbilledExpenses)}</dd></div>
            </dl>
          )}
          {!expenses.data ? <Loader error={expenses.error} retry={expenses.reload} /> : expenseRows.length === 0 ? <Empty title="لا توجد مصاريف" hint="سجّل رسوم المحكمة والطوابع والخبرة هنا." /> : (
            <ul className="rows">{expenseRows.map((row) => (
              <li key={row.id}>
                <span>{row.category} · {money(row.amount)}<small>{formatDate(row.spentAt)} · {row.createdBy.name}{row.description ? ` · ${row.description}` : ""}</small></span>
                {row.invoiceNumber ? <Pill tone="good">{row.invoiceNumber}</Pill> : !row.billable ? <Pill>على المكتب</Pill> : <Pill tone="warn">غير مفوتر</Pill>}
                {!row.invoiceNumber && (senior || row.createdById === user.id) && (
                  <button className="icon-btn" aria-label={`حذف مصروف ${row.category}`} onClick={() => setRemoving({ kind: "expense", id: row.id, label: `${row.category} ${money(row.amount)}` })}><Trash2 size={15} /></button>
                )}
              </li>
            ))}</ul>
          )}
        </section>
      )}

      <section className="card">
        <header className="card-head"><h2><Clock size={18} /> ساعات العمل</h2><button className="link-btn" onClick={() => setModal("time")}><Plus size={15} /> تسجيل وقت</button></header>
        {timeRows.length > 0 && (
          <dl className="money-facts">
            <div><dt>{senior ? "مجموع الساعات" : "ساعاتك"}</dt><dd>{formatMinutes(minutes)}</dd></div>
            <div><dt>غير مفوترة</dt><dd>{formatMinutes(unbilledMinutes)}</dd></div>
          </dl>
        )}
        {!time.data ? <Loader error={time.error} retry={time.reload} /> : timeRows.length === 0 ? <Empty title="لا توجد ساعات مسجلة" hint="سجّل وقت المراجعة والصياغة والحضور." /> : (
          <ul className="rows">{timeRows.map((row) => (
            <li key={row.id}>
              <span>{formatMinutes(row.minutes)} · {row.description}<small>{formatDate(row.workedAt)} · {row.user.name}</small></span>
              {row.invoiceNumber ? <Pill tone="good">{row.invoiceNumber}</Pill> : !row.billable ? <Pill>غير قابلة للفوترة</Pill> : null}
              {!row.invoiceNumber && (senior || row.userId === user.id) && (
                <button className="icon-btn" aria-label="حذف سجل الوقت" onClick={() => setRemoving({ kind: "time", id: row.id, label: `${formatMinutes(row.minutes)} — ${row.description}` })}><Trash2 size={15} /></button>
              )}
            </li>
          ))}</ul>
        )}
      </section>

      {modal === "expense" && <FormModal title="تسجيل مصروف" fields={expenseFields} onClose={() => setModal("")} onSubmit={async (values) => { await saveExpense(caseId, values); await expenses.reload(); }} />}
      {modal === "time" && <FormModal title="تسجيل وقت عمل" fields={timeFields} onClose={() => setModal("")} onSubmit={async (values) => { await saveTime(caseId, values); await time.reload(); }} />}
      {removing && (
        <Confirm
          title={removing.kind === "expense" ? "حذف المصروف" : "حذف سجل الوقت"}
          body={`حذف «${removing.label}» نهائياً؟`}
          action="حذف"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await send(`/api/${removing.kind === "expense" ? "expenses" : "time"}?id=${removing.id}`, "DELETE");
            await (removing.kind === "expense" ? expenses.reload() : time.reload());
          }}
        />
      )}
    </>
  );
}
