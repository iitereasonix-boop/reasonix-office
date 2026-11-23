"use client";

import { CheckSquare, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useUser } from "@/components/AppShell";
import { Empty, formatDate, FormModal, Loader, PageHead, Pill, priorities, send, useData } from "@/components/ui";

type Task = {
  id: string; title: string; notes: string | null; priority: string; dueAt: string | null; completedAt: string | null;
  assignee: { id: string; name: string }; legalCase: { id: string; caseNumber: string } | null;
};

export default function TasksPage() {
  const user = useUser();
  const { data, error, reload } = useData<{ tasks: Task[] }>("/api/tasks");
  const { data: cases } = useData<{ cases: { id: string; caseNumber: string; title: string }[] }>("/api/cases");
  const { data: team } = useData<{ staff: { id: string; name: string }[] }>("/api/team");
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [failure, setFailure] = useState("");

  async function update(url: string, method: string, body?: object) {
    setFailure("");
    try {
      await send(url, method, body);
      await reload();
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر التنفيذ.");
    }
  }

  const tasks = data?.tasks.filter((task) => showDone || !task.completedAt) ?? [];
  const now = Date.now();

  return (
    <>
      <PageHead title="المهام" subtitle="ما يجب إنجازه لكل قضية." action={<button className="btn btn-gold" onClick={() => setCreating(true)}><Plus size={17} /> مهمة جديدة</button>} />
      <div className="filters"><label className="check"><input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} /> إظهار المنجزة</label></div>
      {failure && <div className="notice notice-error">{failure}</div>}
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : tasks.length === 0 ? <Empty title="لا توجد مهام مفتوحة" icon={<CheckSquare size={28} />} /> : (
          <ul className="task-list">{tasks.map((task) => (
            <li key={task.id} className={task.completedAt ? "done" : ""}>
              <input type="checkbox" checked={!!task.completedAt} aria-label={`إنجاز ${task.title}`} onChange={(event) => void update(`/api/tasks?id=${task.id}`, "PATCH", { completed: event.target.checked })} />
              <div>
                <b>{task.title}</b>
                <small>
                  {task.assignee.name}
                  {task.legalCase && <> · <Link href={`/app/cases/${task.legalCase.id}`}>القضية {task.legalCase.caseNumber}</Link></>}
                  {task.dueAt && ` · ${formatDate(task.dueAt)}`}
                </small>
              </div>
              {!task.completedAt && task.dueAt && new Date(task.dueAt).getTime() < now && <Pill tone="bad">متأخرة</Pill>}
              {task.priority === "HIGH" && <Pill tone="warn">أولوية عالية</Pill>}
              <button className="icon-btn" aria-label={`حذف ${task.title}`} onClick={() => void update(`/api/tasks?id=${task.id}`, "DELETE")}><Trash2 size={15} /></button>
            </li>
          ))}</ul>
        )}
      </section>
      {creating && (
        <FormModal
          title="مهمة جديدة"
          fields={[
            { name: "title", label: "المهمة", required: true, wide: true },
            ...(user.role === "TRAINEE_LAWYER" ? [] : [{ name: "assigneeId", label: "المسؤول", type: "select" as const, defaultValue: user.id, required: true, options: team?.staff.map((member): [string, string] => [member.id, member.name]) }]),
            { name: "caseId", label: "القضية", type: "select", placeholder: "بدون قضية", options: cases?.cases.map((item) => [item.id, `${item.caseNumber} — ${item.title}`]) },
            { name: "dueAt", label: "تاريخ الإنجاز", type: "date" },
            { name: "priority", label: "الأولوية", type: "select", required: true, defaultValue: "NORMAL", options: Object.entries(priorities) },
          ]}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => { await send("/api/tasks", "POST", values); await reload(); }}
        />
      )}
    </>
  );
}
