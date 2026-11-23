"use client";

import { Check, Inbox, Phone, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Empty, formatDateTime, Loader, PageHead, Pill, send, useData } from "@/components/ui";

type Consultation = { id: string; name: string; phone: string; email: string | null; topic: string; message: string; preferredAt: string | null; status: string; createdAt: string };

const labels: Record<string, [string, string]> = {
  NEW: ["جديد", "warn"], CONTACTED: ["تم التواصل", "info"], CONVERTED: ["أصبح عميلاً", "good"], CLOSED: ["مغلق", "neutral"],
};

export default function ConsultationsPage() {
  const router = useRouter();
  const { data, error, reload } = useData<{ requests: Consultation[] }>("/api/consultations");
  const [failure, setFailure] = useState("");

  async function setStatus(id: string, status: string) {
    setFailure("");
    try {
      await send(`/api/consultations?id=${id}`, "PATCH", { status });
      if (status === "CONVERTED") router.push("/app/clients");
      else await reload();
    } catch (issue) {
      setFailure(issue instanceof Error ? issue.message : "تعذر التنفيذ.");
    }
  }

  return (
    <>
      <PageHead title="طلبات الاستشارة" subtitle="الطلبات الواردة من الموقع." />
      {failure && <div className="notice notice-error">{failure}</div>}
      <section className="card">
        {!data ? <Loader error={error} retry={reload} /> : data.requests.length === 0 ? <Empty title="لا توجد طلبات" icon={<Inbox size={28} />} /> : (
          <ul className="wa-list">{data.requests.map((item) => (
            <li key={item.id}>
              <div className="wa-head"><b>{item.name} · {item.topic}</b><Pill tone={labels[item.status][1]}>{labels[item.status][0]}</Pill></div>
              <p>{item.message}</p>
              <div className="wa-foot">
                <small>{formatDateTime(item.createdAt)}{item.preferredAt ? ` · الموعد المفضل ${formatDateTime(item.preferredAt)}` : ""}</small>
                <span className="spacer" />
                <a className="btn btn-ghost btn-sm" href={`tel:${item.phone}`} dir="ltr"><Phone size={15} /> {item.phone}</a>
                {item.status === "NEW" && <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(item.id, "CONTACTED")}><Check size={15} /> تم التواصل</button>}
                {(item.status === "NEW" || item.status === "CONTACTED") && <>
                  <button className="btn btn-gold btn-sm" onClick={() => void setStatus(item.id, "CONVERTED")}><UserPlus size={15} /> تحويل إلى عميل</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(item.id, "CLOSED")}><X size={15} /> إغلاق</button>
                </>}
              </div>
            </li>
          ))}</ul>
        )}
      </section>
    </>
  );
}
