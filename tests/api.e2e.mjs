// End-to-end checks over HTTP, as every role, against a fresh database loaded with db:demo.
// See README: it needs the production server plus tests/mocks/claude.mjs and whatsapp.mjs.
import { createHmac } from "node:crypto";
import JSZip from "jszip";
import pg from "pg";

const base = process.env.BASE_URL || "http://localhost:3100";
const WEBHOOK_SECRET = process.env.WHATSAPP_APP_SECRET || "test-secret";
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`); };

async function login(email, password = "LocalDemo-2026!") {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  return { status: res.status, api: async (path, init = {}) => {
    const r = await fetch(base + path, { ...init, headers: { cookie, ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init.headers } });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  } };
}
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body) => ({ method: "PATCH", body: JSON.stringify(body) });

async function chat(session, question, extra = {}) {
  const r = await session.api("/api/assistant/chat", post({ question, ...extra }));
  const events = r.text.split("\n\n").filter((c) => c.startsWith("data: ")).map((c) => JSON.parse(c.slice(6)));
  return { status: r.status, events, done: events.find((e) => e.type === "done"), json: r.json };
}

const anon = await fetch(`${base}/api/cases`);
check("anonymous blocked from cases", anon.status === 401);
const bad = await login("alaa@reasonix.local", "wrong");
check("wrong password rejected", bad.status === 401);

const senior = await login("alaa@reasonix.local");
const trainee = await login("trainee@reasonix.local");
const secretary = await login("secretary@reasonix.local");
check("three roles log in", senior.status === 200 && trainee.status === 200 && secretary.status === 200, `${senior.status} ${trainee.status} ${secretary.status}`);

const cases = (await senior.api("/api/cases")).json.cases;
check("senior sees all 5 cases", cases.length === 5, JSON.stringify(cases?.length));
const civil = cases.find((c) => c.caseNumber === "2026/124");
const family = cases.find((c) => c.caseNumber === "2026/098");

const traineeCases = (await trainee.api("/api/cases")).json.cases;
check("trainee sees only assigned case", traineeCases.length === 1 && traineeCases[0].caseNumber === "2026/124", JSON.stringify(traineeCases?.map((c) => c.caseNumber)));
check("trainee blocked from other case detail", (await trainee.api(`/api/cases?id=${family.id}`)).status === 404);
const traineeClients = (await trainee.api("/api/clients")).json.clients;
check("trainee sees only linked client", traineeClients.length === 1, JSON.stringify(traineeClients?.length));
check("trainee cannot create case", (await trainee.api("/api/cases", post({}))).status === 403);
check("trainee cannot read consultations", (await trainee.api("/api/consultations")).status === 403);
const secCase = (await secretary.api(`/api/cases?id=${civil.id}`)).json.case;
check("secretary: private notes and fees hidden", secCase.privateNotes === null && secCase.fees === null);
check("secretary: national id hidden", secCase.client.nationalId === null);
const seniorCase = (await senior.api(`/api/cases?id=${civil.id}`)).json.case;
check("senior: private notes visible", !!seniorCase.privateNotes && seniorCase.documents.length === 3);

for (const path of ["overview", "notifications", "hearings", "judgments", "documents", "drafts", "messages", "tasks", "consultations", "reports", "team", "search?q=عقد", "clients"]) {
  const r = await senior.api(`/api/${path}`);
  check(`GET /api/${path}`, r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
}
const search = (await senior.api(`/api/search?q=${encodeURIComponent("الشركه")}`)).json.results;
check("search folds Arabic spelling (ة/ه)", search.some((r) => r.kind === "عميل" || r.kind === "مستند"), JSON.stringify(search));

// Public booking, no session, RLS with empty role.
const booked = await fetch(`${base}/api/consultations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "زائر تجريبي", phone: "+962790000010", topic: "الأحوال الشخصية", message: "أحتاج إلى استشارة", email: "", preferredAt: "" }) });
check("public booking accepted", booked.status === 201, await booked.text());
const bot = await fetch(`${base}/api/consultations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "بوت", phone: "+962790000011", topic: "x y", message: "spam spam", website: "http://x" }) });
check("honeypot rejected", bot.status === 400);
const requests = (await secretary.api("/api/consultations")).json.requests;
check("booking visible to secretary", requests.some((r) => r.name === "زائر تجريبي"));
const convert = await secretary.api(`/api/consultations?id=${requests.find((r) => r.name === "زائر تجريبي").id}`, patch({ status: "CONVERTED" }));
check("consultation converts to client", convert.status === 200 && !!convert.json.clientId, convert.text);

// Writes through RLS.
const hearing = await secretary.api("/api/hearings", post({ caseId: civil.id, startsAt: "2026-12-01T07:00:00.000Z", purpose: "اختبار" }));
check("secretary records hearing", hearing.status === 201, hearing.text);
const hp = await secretary.api(`/api/hearings?id=${hearing.json.hearing.id}`, patch({ decision: "تأجيل" }));
check("secretary records hearing decision", hp.status === 200, hp.text);
check("secretary deletes hearing", (await secretary.api(`/api/hearings?id=${hearing.json.hearing.id}`, { method: "DELETE" })).status === 200);
const task = await trainee.api("/api/tasks", post({ title: "مهمة متدرب", caseId: civil.id }));
check("trainee adds task", task.status === 201, task.text);
check("trainee cannot attach task to hidden case", (await trainee.api("/api/tasks", post({ title: "مهمة ممنوعة", caseId: family.id }))).status === 404);
check("trainee completes task", (await trainee.api(`/api/tasks?id=${task.json.task.id}`, patch({ completed: true }))).status === 200);
const seniorJudgment = await senior.api("/api/judgments", post({ caseId: civil.id, title: "حكم اختبار", decidedAt: "2026-10-01T07:00:00.000Z", summary: "نص" }));
check("senior records judgment", seniorJudgment.status === 201, seniorJudgment.text);
check("secretary cannot record judgment", (await secretary.api("/api/judgments", post({}))).status === 403);

// WhatsApp lifecycle.
const clientId = seniorCase.client.id;
const msg = await trainee.api("/api/messages", post({ clientId, body: "رسالة اختبار" }));
check("trainee drafts message", msg.status === 201, msg.text);
check("trainee cannot approve message", (await trainee.api(`/api/messages?id=${msg.json.message.id}`, patch({ action: "approve" }))).status === 403);
check("cannot mark an unapproved message sent", (await secretary.api(`/api/messages?id=${msg.json.message.id}`, patch({ action: "markSent" }))).status === 409);
check("senior approves message", (await senior.api(`/api/messages?id=${msg.json.message.id}`, patch({ action: "approve" }))).status === 200);
check("secretary logs send", (await secretary.api(`/api/messages?id=${msg.json.message.id}`, patch({ action: "markSent" }))).status === 200);

// Document upload and search.
const form = new FormData();
form.set("caseId", civil.id);
form.set("title", "مذكرة اختبار");
form.set("file", new File(["الصفحة الأولى عن شهادة زيد\fالصفحة الثانية عن فاتورة الإسمنت"], "memo.txt", { type: "text/plain" }));
const up = await trainee.api("/api/documents", { method: "POST", body: form });
check("trainee uploads to own case", up.status === 201 && up.json.document.pageCount === 2, up.text);
const denied = new FormData();
denied.set("caseId", family.id);
denied.set("title", "مستند ممنوع");
denied.set("file", new File(["نص طويل بما يكفي للاختبار"], "x.txt", { type: "text/plain" }));
check("trainee cannot upload to hidden case", (await trainee.api("/api/documents", { method: "POST", body: denied })).status === 404);
const exe = new FormData();
exe.set("caseId", civil.id);
exe.set("file", new File(["MZ"], "x.exe", { type: "application/x-msdownload" }));
check("disallowed file type rejected", (await senior.api("/api/documents", { method: "POST", body: exe })).status === 400);
const page = await senior.api(`/api/documents?id=${up.json.document.id}`);
check("document pages split", page.json.document.pages[1].text.includes("الإسمنت"));
const raw = await senior.api(`/api/documents/file?id=${up.json.document.id}`);
check("original file served", raw.status === 200 && raw.text.includes("شهادة زيد"));

// Assistant, through the mock model.
const refused = await senior.api("/api/assistant/chat", post({ question: "مرحبا" }));
check("assistant stays off until the lawyer enables it", refused.status === 503, refused.text);
check("secretary cannot enable AI", (await secretary.api("/api/office", patch({ aiEnabled: true }))).status === 403);
check("senior enables AI", (await senior.api("/api/office", patch({ aiEnabled: true }))).status === 200);
const answer = await chat(senior, "ما آخر قرار في القضية رقم 2026/124؟");
check("chat streams to done", !!answer.done, JSON.stringify(answer.events.slice(-2)) + JSON.stringify(answer.json));
check("chat emits progress", answer.events.some((e) => e.type === "status"));
check("fake citation removed", !answer.done.text.includes("S99"), answer.done.text);
check("only cited sources returned", answer.done.sources.length === 2 && answer.done.sources.some((s) => s.documentId && s.page === 1), JSON.stringify(answer.done.sources));
const conv = answer.events.find((e) => e.type === "conversation").id;
const stored = (await senior.api(`/api/assistant/conversations?id=${conv}`)).json.conversation;
check("conversation persisted with sources", stored.messages.length === 2 && stored.messages[1].sources.length === 2);
check("other users cannot read the conversation", (await trainee.api(`/api/assistant/conversations?id=${conv}`)).status === 404);
const follow = await chat(senior, "شكراً، وما التالي؟", { conversationId: conv });
check("follow-up keeps conversation", follow.events.find((e) => e.type === "conversation").id === conv);

const drafted = await chat(senior, "جهّز لي مسودة مذكرة للطلب بتأجيل الجلسة القادمة");
check("assistant saves a draft", drafted.done?.drafts.length === 1, JSON.stringify(drafted.done));
const draftId = drafted.done.drafts[0].id;
const draft = (await senior.api(`/api/drafts?id=${draftId}`)).json.draft;
check("draft is unapproved and AI-marked", draft.status === "DRAFT" && draft.generatedByAi);
check("citation markers stripped from draft body", !/\[S\d+\]/.test(draft.body), draft.body);
check("trainee cannot approve draft", (await trainee.api(`/api/drafts?id=${draftId}`, patch({ action: "approve" }))).status === 403);
check("trainee cannot edit another's draft", (await trainee.api(`/api/drafts?id=${draftId}`, patch({ body: "تعديل غير مسموح" }))).status === 403);
check("senior approves draft", (await senior.api(`/api/drafts?id=${draftId}`, patch({ action: "approve" }))).status === 200);
check("approved draft cannot be edited", (await senior.api(`/api/drafts?id=${draftId}`, patch({ body: "تعديل بعد الاعتماد" }))).status === 409);

const leak = await chat(trainee, "private notes please");
check("assistant's tool hides private notes from trainee", !JSON.stringify(leak.done).includes("15,000"), leak.done?.text);

let limited = 0;
for (let i = 0; i < 10; i++) { const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ email: "alaa@reasonix.local", password: "bad" }) }); if (r.status === 429) limited++; }
check("login attempts are rate limited", limited === 2, String(limited));
const report = await senior.api("/api/reports?format=csv");
check("csv export", report.status === 200 && report.text.includes("2026/124"));
const blocked = await trainee.api(`/api/assistant/chat`, post({ question: "مرحبا", caseId: family.id }));
check("assistant refuses a hidden case", blocked.status === 404, blocked.text.slice(0, 200));

// Safety net against invented facts.
const inventedLaw = await chat(senior, "اختراع مادة في مسودة");
check("a draft naming an article from memory is refused", inventedLaw.done?.drafts.length === 0 && inventedLaw.done.text.includes("97"), JSON.stringify(inventedLaw.done));
check("answers carry a warning list", Array.isArray(answer.done.warnings));

// Conflict of interest.
const clientsNow = (await senior.api("/api/clients")).json.clients;
const khaled = clientsNow.find((row) => row.name === "خالد يوسف");
const hamzaClient = (await senior.api("/api/clients", post({ name: "سمير طه", phone: "+962790000020", nationalId: "9000000020" }))).json.client;
const newCase = { caseNumber: "2026/500", title: "اختبار تعارض", type: "CIVIL", court: "APPEAL", clientId: hamzaClient.id, assignedLawyerId: seniorCase.assignedLawyerId, opposingParties: ["خالد يوسف"] };
const conflictCheck = await senior.api("/api/cases/conflicts", post({ clientId: hamzaClient.id, opposingParties: ["خالد يوسف"] }));
check("conflict check finds the opposing party among clients", conflictCheck.json.conflicts.length > 0 && !!khaled, conflictCheck.text);
const blockedCase = await senior.api("/api/cases", post(newCase));
check("case with a conflict needs acknowledgement", blockedCase.status === 409 && blockedCase.json.conflicts.length > 0, blockedCase.text);
const allowedCase = await senior.api("/api/cases", post({ ...newCase, acknowledgeConflict: true }));
check("acknowledged conflict opens the case", allowedCase.status === 201, allowedCase.text);

// Add update, timeline.
const updated = await secretary.api("/api/cases/updates", post({ caseId: civil.id, kind: "ADJOURNMENT", occurredAt: "2026-11-01T07:00:00.000Z", note: "تأجيل لتقديم البينات", nextHearingAt: "2027-01-10T07:00:00.000Z" }));
check("secretary adds an update with the next hearing", updated.status === 201, updated.text);
check("secretary cannot change status through an update", (await secretary.api("/api/cases/updates", post({ caseId: civil.id, kind: "OTHER", occurredAt: "2026-11-01T07:00:00.000Z", note: "ملاحظة", status: "CLOSED" }))).status === 403);
check("trainee cannot add an update", (await trainee.api("/api/cases/updates", post({ caseId: civil.id, kind: "OTHER", occurredAt: "2026-11-01T07:00:00.000Z", note: "ملاحظة" }))).status === 403);
const fileAfter = (await trainee.api("/api/cases?id=" + civil.id)).json;
check("update appears in the case, with a new hearing and timeline", fileAfter.case.updates.length === 1 && fileAfter.case.hearings.some((row) => row.startsAt.startsWith("2027-01-10")) && fileAfter.timeline.some((row) => row.action === "CASE_UPDATE_ADDED"), JSON.stringify(fileAfter.timeline?.slice(0, 3)));

// Deadlines come from the lawyer's rules and need confirmation.
check("secretary cannot add a deadline rule", (await secretary.api("/api/office", post({ name: "ق", days: 30, base: "NOTIFICATION", legalBasis: "سند" }))).status === 403);
const rule = (await senior.api("/api/office", post({ name: "قاعدة تجربة", days: 30, base: "NOTIFICATION", legalBasis: "سند يحدده المحامي" }))).json.rule;
const withoutDate = await senior.api("/api/judgments", post({ caseId: civil.id, title: "حكم بلا تبليغ", decidedAt: "2026-10-01T06:00:00.000Z", summary: "نص", ruleId: rule.id }));
check("a rule needing the notification date refuses to guess", withoutDate.status === 400, withoutDate.text);
const judged = await senior.api("/api/judgments", post({ caseId: civil.id, judgmentNumber: "55/2026", title: "حكم للتجربة", decidedAt: "2026-10-01T06:00:00.000Z", notifiedAt: "2026-10-11T06:00:00.000Z", summary: "نص", ruleId: rule.id }));
check("a rule gives a proposal, never a deadline", judged.status === 201 && judged.json.judgment.appealDeadline === null && judged.json.judgment.proposedDeadline.startsWith("2026-11-10"), judged.text);
check("the rule used is stored with the proposal", judged.json.judgment.deadlineRule.explanation.includes("30 يوماً"));
const confirmed = await senior.api("/api/judgments?id=" + judged.json.judgment.id, patch({ action: "confirmDeadline" }));
check("confirmation sets the deadline and records who", confirmed.json.judgment.appealDeadline?.startsWith("2026-11-10") && !!confirmed.json.judgment.deadlineConfirmedBy, confirmed.text);

// Holidays move a deadline only when the rule asks, and a confirmed deadline creates a task.
check("secretary cannot add holidays", (await secretary.api("/api/office?target=holiday", post({ name: "عطلة", startsOn: "2026-11-10", endsOn: "2026-11-12", kind: "HOLIDAY" }))).status === 403);
check("a holiday ending before it starts is refused", (await senior.api("/api/office?target=holiday", post({ name: "عطلة", startsOn: "2026-11-12", endsOn: "2026-11-10", kind: "HOLIDAY" }))).status === 400);
const holiday = (await senior.api("/api/office?target=holiday", post({ name: "عيد تجريبي", startsOn: "2026-11-10", endsOn: "2026-11-12", kind: "HOLIDAY" }))).json.holiday;
const rollRule = (await senior.api("/api/office", post({ name: "قاعدة تنقل", days: 30, base: "NOTIFICATION", legalBasis: "سند", rollForward: true }))).json.rule;
const moved = await senior.api("/api/judgments", post({ caseId: civil.id, title: "حكم يقع في عطلة", decidedAt: "2026-10-01T06:00:00.000Z", notifiedAt: "2026-10-11T06:00:00.000Z", summary: "نص", ruleId: rollRule.id }));
check("a deadline on a holiday moves to the next working day", moved.json.judgment.proposedDeadline.startsWith("2026-11-15") && moved.json.judgment.deadlineRule.explanation.includes("عيد تجريبي"), moved.text);
await senior.api("/api/judgments?id=" + moved.json.judgment.id, patch({ action: "confirmDeadline" }));
const deadlineTasks = (await senior.api("/api/tasks")).json.tasks.filter((row) => row.title.includes("حكم يقع في عطلة"));
check("a confirmed deadline creates one task for the lawyer", deadlineTasks.length === 1 && deadlineTasks[0].dueAt.startsWith("2026-11-15") && deadlineTasks[0].priority === "HIGH", JSON.stringify(deadlineTasks));
await senior.api("/api/judgments?id=" + moved.json.judgment.id, patch({ appealDeadline: "2026-11-16T06:00:00.000Z" }));
const movedTasks = (await senior.api("/api/tasks")).json.tasks.filter((row) => row.title.includes("حكم يقع في عطلة"));
check("changing the deadline moves the same task", movedTasks.length === 1 && movedTasks[0].dueAt.startsWith("2026-11-16"), JSON.stringify(movedTasks));
await senior.api("/api/judgments?id=" + moved.json.judgment.id, patch({ appealFiledAt: "2026-11-14T06:00:00.000Z" }));
check("filing the appeal completes the task", (await senior.api("/api/tasks")).json.tasks.find((row) => row.title.includes("حكم يقع في عطلة")).completedAt !== null);
check("holidays delete", (await senior.api("/api/office?holiday=" + holiday.id, { method: "DELETE" })).status === 200);

// Ministry of Justice case number.
check("a non-numeric ministry number is refused", (await senior.api("/api/cases?id=" + civil.id, patch({ mojNumber: "abc" }))).status === 400);
check("ministry fields save", (await senior.api("/api/cases?id=" + civil.id, patch({ mojCourt: "قصر عدل عمان", mojJurisdiction: "حقوق", mojRegistry: "بداية", mojNumber: "343", mojYear: 2021 }))).status === 200);
const mojCase = (await trainee.api("/api/cases?id=" + civil.id)).json.case;
check("ministry fields show on the case", mojCase.mojNumber === "343" && mojCase.mojYear === 2021 && mojCase.mojCourt === "قصر عدل عمان");

// Versions, Word, images.
const v2 = new FormData();
v2.set("caseId", civil.id);
v2.set("versionOf", up.json.document.id);
v2.set("file", new File(["نسخة ثانية من المذكرة"], "memo2.txt", { type: "text/plain" }));
const second = await senior.api("/api/documents", { method: "POST", body: v2 });
check("a new version is numbered", second.json.document.version === 2 && second.json.document.title === "مذكرة اختبار", second.text);
const zip = new JSZip();
zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>مذكرة بصيغة وورد</w:t></w:r></w:p></w:body></w:document>');
const wordForm = new FormData();
wordForm.set("caseId", civil.id);
wordForm.set("category", "PLEADING");
wordForm.set("file", new File([await zip.generateAsync({ type: "uint8array" })], "memo.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
const word = await senior.api("/api/documents", { method: "POST", body: wordForm });
check("Word text is extracted", word.json?.document?.extraction === "READY", word.text);
const imageForm = new FormData();
imageForm.set("caseId", civil.id);
imageForm.set("file", new File([Uint8Array.from([137, 80, 78, 71])], "scan.png", { type: "image/png" }));
const image = await senior.api("/api/documents", { method: "POST", body: imageForm });
check("a scanned image is read through OCR", image.json?.document?.extraction === "READY", image.text);

// Sensitive fields.
check("national ID is masked by default", clientsNow.find((row) => row.name === "أحمد محمد علي").nationalId === "••••••0001");
const reveal = await senior.api("/api/clients/reveal?id=" + clientId);
check("permitted reveal returns the full ID", reveal.json.nationalId === "9000000001", reveal.text);
check("secretary cannot reveal a national ID", (await secretary.api("/api/clients/reveal?id=" + clientId)).status === 403);
check("reveal is audited", (await senior.api("/api/audit")).json.entries.some((row) => row.action === "NATIONAL_ID_VIEWED"));

// Trash.
const doomed = (await secretary.api("/api/hearings", post({ caseId: civil.id, startsAt: "2027-03-01T07:00:00.000Z", purpose: "للحذف" }))).json.hearing;
await secretary.api("/api/hearings?id=" + doomed.id, { method: "DELETE" });
const trash = (await senior.api("/api/trash")).json.rows;
check("deleted records reach the trash", trash.some((row) => row.id === doomed.id));
check("secretary cannot open the trash", (await secretary.api("/api/trash")).status === 403);
check("records restore", (await senior.api("/api/trash", post({ kind: "hearing", id: doomed.id }))).status === 200 && (await senior.api("/api/cases?id=" + civil.id)).json.case.hearings.some((row) => row.id === doomed.id));

// Billing.
check("secretary cannot see invoices", (await secretary.api("/api/invoices")).status === 403);
const invoice = (await senior.api("/api/invoices", post({ caseId: civil.id, number: "INV-1", amount: 500, issuedAt: "2026-11-01T07:00:00.000Z" }))).json.invoice;
check("payment is recorded", (await senior.api("/api/invoices?payment=" + invoice.id, post({ amount: 200, paidAt: "2026-11-02T07:00:00.000Z" }))).status === 201);
check("overpayment is refused", (await senior.api("/api/invoices?payment=" + invoice.id, post({ amount: 301, paidAt: "2026-11-02T07:00:00.000Z" }))).status === 400);
check("balance is computed", (await senior.api("/api/invoices")).json.invoices[0].balance === 300);

// Library and templates.
check("only the senior lawyer adds law text", (await secretary.api("/api/library", post({ title: "قانون", reference: "مرجع", text: "المادة 1\nنص الاختبار" }))).status === 403);
const added = await senior.api("/api/library", post({ title: "قانون تجربة", reference: "مرجع تجربة", text: "المادة 1\nنص اختبار أول\nالمادة 2\nنص ثان" }));
check("law text splits into articles", added.json.articles === 2, added.text);
const lawAnswer = await chat(senior, "ابحث في المكتبة");
check("assistant cites the library, not memory", lawAnswer.done?.sources.some((row) => row.kind === "law"), JSON.stringify(lawAnswer.done));
const template = (await trainee.api("/api/templates")).json.templates.find((row) => row.name === "مذكرة");
const filled = await trainee.api("/api/templates?fill=1", post({ templateId: template.id, caseId: civil.id }));
const filledDraft = (await senior.api("/api/drafts?id=" + filled.json.draft.id)).json.draft;
check("templates fill from the case and stay drafts", filledDraft.status === "DRAFT" && filledDraft.body.includes("2026/124") && !filledDraft.body.includes("{{case_number}}"), filledDraft.body);

// Intake.
const intakeForm = new FormData();
intakeForm.append("files", new File(["محكمة استئناف عمان\nالقضية رقم 2026/777\nالموكل: أحمد محمد علي\nالجلسة 2026-12-20 10:00"], "good.txt", { type: "text/plain" }));
intakeForm.append("files", new File(["ورقة فيها مختلق ولا شيء آخر"], "fake.txt", { type: "text/plain" }));
check("trainee cannot use intake", (await trainee.api("/api/intake")).status === 403);
const intake = await secretary.api("/api/intake", { method: "POST", body: intakeForm });
check("intake reads the files", intake.status === 201, intake.text);
const queue = (await secretary.api("/api/intake")).json.items;
const good = queue.find((row) => row.fileName === "good.txt");
const fake = queue.find((row) => row.fileName === "fake.txt");
check("a confident match is a suggestion, not a saved case", good.status === "SUGGESTED" && good.extracted.case_number.value === "2026/777" && good.matchedClientId === clientId, JSON.stringify(good));
check("nothing was saved yet", !(await senior.api("/api/cases")).json.cases.some((row) => row.caseNumber === "2026/777"));
check("invented values are dropped and need review", fake.status === "NEEDS_REVIEW" && fake.extracted.case_number.value === null && fake.extracted.client_name.value === null, JSON.stringify(fake));
const accept = { action: "accept", clientId, caseNumber: "2026/777", title: "من التوزيع", type: "COMMERCIAL", court: "APPEAL", assignedLawyerId: seniorCase.assignedLawyerId };
check("secretary cannot finalise intake", (await secretary.api("/api/intake?id=" + good.id, patch(accept))).status === 403);
const accepted = await senior.api("/api/intake?id=" + good.id, patch(accept));
check("accepting opens the case with its document and hearing", accepted.status === 200, accepted.text);
const intakeCase = (await senior.api("/api/cases?id=" + accepted.json.caseId)).json.case;
check("accepted file is attached", intakeCase.documents.length === 1 && intakeCase.hearings.length === 1, JSON.stringify(intakeCase.hearings));
check("every agent call is logged", (await senior.api("/api/audit?view=agents")).json.runs.some((row) => row.agent === "intake") && (await senior.api("/api/audit?view=agents")).json.runs.some((row) => row.agent === "case-assistant"));
check("staff cannot read the agent log", (await secretary.api("/api/audit?view=agents")).status === 403);

// Reminders and WhatsApp.
await senior.api("/api/office", patch({ quietStart: 0, quietEnd: 24 }));
const firstRun = await secretary.api("/api/whatsapp/reminders", { method: "POST" });
check("reminders are created as drafts", firstRun.json.created > 0 && firstRun.json.sent === 0, firstRun.text);
check("reminders are not repeated", (await secretary.api("/api/whatsapp/reminders", { method: "POST" })).json.created === 0);
const queueMessages = (await senior.api("/api/messages")).json;
check("WhatsApp integration reports configured", queueMessages.apiConfigured === true);
const reminder = queueMessages.messages.find((row) => row.reminderKind);
check("reminder waits for approval", reminder.status === "DRAFT");
check("an unapproved message cannot be sent", (await senior.api("/api/messages?id=" + reminder.id, patch({ action: "send" }))).status === 409);
await senior.api("/api/messages?id=" + reminder.id, patch({ action: "approve" }));
check("trainee cannot send", (await trainee.api("/api/messages?id=" + reminder.id, patch({ action: "send" }))).status === 403);
const delivered = await secretary.api("/api/messages?id=" + reminder.id, patch({ action: "send" }));
check("approved message goes through the API", delivered.json?.result?.outcome === "sent", delivered.text);
const outbox = await (await fetch("http://localhost:4600/sent")).json();
check("the API received it", outbox.length === 1, JSON.stringify(outbox));

const signed = (payload) => {
  const body = JSON.stringify(payload);
  return fetch(base + "/api/whatsapp/webhook", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex") } });
};
const inbound = (id, from, text) => ({ entry: [{ changes: [{ value: { messages: [{ id, from, type: "text", text: { body: text } }] } }] }] });
check("unsigned webhook is rejected", (await fetch(base + "/api/whatsapp/webhook", { method: "POST", body: "{}" })).status === 401);
check("webhook verification rejects a bad token", (await fetch(base + "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1")).status === 403);
await signed(inbound("in1", "962790000003", "متى الجلسة؟"));
await signed(inbound("in1", "962790000003", "متى الجلسة؟"));
await signed(inbound("in2", "962799999999", "من أنتم؟"));
const afterInbound = (await senior.api("/api/messages")).json.messages;
check("inbound links to the client by phone, once", afterInbound.filter((row) => row.waMessageId === "in1").length === 1 && afterInbound.find((row) => row.waMessageId === "in1").client?.name === "خالد يوسف");
check("an unknown number stays unlinked", afterInbound.find((row) => row.waMessageId === "in2").client === null);
await signed(inbound("in3", "962790000002", "STOP"));
const amal = clientsNow.find((row) => row.name === "شركة الأمل");
check("STOP unsubscribes the client", !!(await senior.api("/api/clients")).json.clients.find((row) => row.id === amal.id).whatsappOptOutAt);
const stopped = (await senior.api("/api/messages", post({ clientId: amal.id, body: "رسالة بعد الإلغاء" }))).json.message;
await senior.api("/api/messages?id=" + stopped.id, patch({ action: "approve" }));
const blockedSend = await senior.api("/api/messages?id=" + stopped.id, patch({ action: "send" }));
check("an unsubscribed client receives nothing", blockedSend.json?.result?.outcome === "blocked" && (await (await fetch("http://localhost:4600/sent")).json()).length === 1, blockedSend.text);
const hourNow = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
const closedStart = (hourNow + 2) % 22;
await senior.api("/api/office", patch({ quietStart: closedStart, quietEnd: closedStart + 1 }));
const later = (await senior.api("/api/messages", post({ clientId, body: "رسالة خارج الساعات" }))).json.message;
await senior.api("/api/messages?id=" + later.id, patch({ action: "approve" }));
const scheduled = await secretary.api("/api/messages?id=" + later.id, patch({ action: "send" }));
check("outside sending hours a message is scheduled, also for the secretary", scheduled.json?.result?.outcome === "scheduled", scheduled.text);
check("the secretary still has no database right over an approved message", (await secretary.api("/api/messages?id=" + later.id, patch({ body: "تعديل بعد الاعتماد" }))).status === 409);
await senior.api("/api/office", patch({ quietStart: 9, quietEnd: 20 }));

// Calendar.
const ics = await senior.api("/api/calendar");
check("ICS export works", ics.status === 200 && ics.text.includes("BEGIN:VEVENT"));
check("ICS needs a session or token", (await fetch(base + "/api/calendar")).status === 401);
const calToken = (await trainee.api("/api/calendar", { method: "POST" })).json.token;
const feed = await (await fetch(base + "/api/calendar?token=" + calToken)).text();
check("the private feed respects the owner's cases", feed.includes("2026/124") && !feed.includes("2026/098"));
check("a wrong token is rejected", (await fetch(base + "/api/calendar?token=nope")).status === 404);

// Client portal.
const portalPhone = "+962790000001";
const otp = await fetch(base + "/api/portal/otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: portalPhone }) });
const unknownOtp = await fetch(base + "/api/portal/otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "+962799999123" }) });
check("the portal does not reveal who is a client", (await otp.text()) === (await unknownOtp.text()));
const code = (await (await fetch("http://localhost:4600/sent")).json()).at(-1).text.body.match(/\d{6}/)[0];
const wrong = await fetch(base + "/api/portal/otp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: portalPhone, code: "000000" }) });
check("a wrong code is refused", wrong.status === 401);
const verified = await fetch(base + "/api/portal/otp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: portalPhone, code }) });
check("the right code signs the client in", verified.status === 200, await verified.clone().text());
const clientCookie = verified.headers.get("set-cookie")?.split(";")[0];
const asClient = (path) => fetch(base + path, { headers: { cookie: clientCookie } });
const portal = await (await asClient("/api/portal")).json();
check("the client sees only their own cases", portal.cases.length >= 1 && portal.cases.every((row) => ["2026/124", "2026/777"].includes(row.caseNumber)), JSON.stringify(portal.cases.map((row) => row.caseNumber)));
check("the portal hides notes, fees and decisions", !JSON.stringify(portal).match(/privateNotes|fees|decision|documents/));
for (const path of ["/api/cases", "/api/clients", "/api/documents", "/api/messages", "/api/judgments", "/api/invoices"]) check("client blocked from " + path, (await asClient(path)).status === 403);
check("staff cannot use the portal API", (await senior.api("/api/portal")).status === 403);

// Office profile and the AI key.
check("a key the provider rejects is refused", (await senior.api("/api/office?target=ai-key", patch({ aiApiKey: "sk-bad-" + "x".repeat(40) }))).status === 400);
const secretKey = "sk-test-" + "x".repeat(40);
check("only the senior lawyer sets the AI key", (await secretary.api("/api/office?target=ai-key", patch({ aiApiKey: secretKey }))).status === 403);
check("a malformed key is refused", (await senior.api("/api/office?target=ai-key", patch({ aiApiKey: "short" }))).status === 400);
check("the key saves", (await senior.api("/api/office?target=ai-key", patch({ aiApiKey: secretKey }))).status === 200);
const officeView = await senior.api("/api/office");
check("the key is never returned, not even partly", !officeView.text.includes("sk-test") && !officeView.text.includes("aiApiKey") && officeView.json.integrations.claudeKey === true);
check("the key stays out of the audit log", !(await senior.api("/api/audit")).text.includes("sk-test"));
const rawDb = new pg.Client({ connectionString: process.env.DATABASE_URL.replace(/\?.*$/, "") });
await rawDb.connect();
await rawDb.query("BEGIN");
await rawDb.query("SELECT set_config('app.user_role', 'SENIOR_LAWYER', true)");
const storedKey = (await rawDb.query('SELECT "aiApiKey" FROM "OfficeSetting"')).rows[0].aiApiKey;
await rawDb.query("ROLLBACK");
await rawDb.end();
check("the key is stored encrypted", storedKey.startsWith("enc:v1:") && !storedKey.includes("sk-test"));
check("the provider and model are detected", officeView.json.integrations.aiProvider === "OpenAI" && officeView.json.settings.aiModel === "gpt-5", JSON.stringify(officeView.json.integrations));
check("a new provider turns AI off until approved again", officeView.json.settings.aiEnabled === false && (await senior.api("/api/assistant/chat", post({ question: "مرحبا" }))).status === 503);
await senior.api("/api/office", patch({ aiEnabled: true }));
const withSavedKey = await chat(senior, "ما آخر قرار في القضية رقم 2026/124؟");
check("the assistant runs on another provider with office tools", withSavedKey.done?.sources.length === 1 && withSavedKey.done.text.includes("[S1]"), JSON.stringify(withSavedKey.events.slice(-1)));
check("citation checks hold on other providers", !withSavedKey.done.text.includes("S99") && withSavedKey.done.warnings.includes("2031/1/1"), withSavedKey.done.text);
const otherIntake = new FormData();
otherIntake.append("files", new File(["القضية رقم 2026/901"], "other.txt", { type: "text/plain" }));
await secretary.api("/api/intake", { method: "POST", body: otherIntake });
check("intake runs on another provider", (await secretary.api("/api/intake")).json.items.find((row) => row.fileName === "other.txt")?.extracted?.case_number?.value === "2026/901");
const otherScan = new FormData();
otherScan.set("caseId", civil.id);
otherScan.set("file", new File([Uint8Array.from([37, 80, 68, 70])], "scan.pdf", { type: "application/pdf" }));
check("an unreadable scan is still saved", (await senior.api("/api/documents", { method: "POST", body: otherScan })).status === 201);
const healDb = new pg.Client({ connectionString: process.env.DATABASE_URL.split("?")[0] });
await healDb.connect();
await healDb.query("BEGIN");
await healDb.query("SELECT set_config('app.user_role', 'SENIOR_LAWYER', true)");
await healDb.query('UPDATE "OfficeSetting" SET "aiProvider" = NULL, "aiModel" = NULL');
await healDb.query("COMMIT");
await healDb.end();
const healed = await chat(senior, "ما آخر قرار في القضية رقم 2026/124؟");
check("a key saved before providers existed works without re-entry", healed.done?.sources.length === 1 && (await senior.api("/api/office")).json.settings.aiProvider === "openai", JSON.stringify(healed.events.slice(-1)));
check("the key can be removed", (await senior.api("/api/office?target=ai-key", patch({ aiApiKey: null }))).status === 200);

check("a bad WhatsApp number is refused", (await senior.api("/api/office?target=contact", patch({ officeWhatsapp: "abc", officeAddress: "", officeMapUrl: "" }))).status === 400);
check("secretary cannot change the office profile", (await secretary.api("/api/office?target=contact", patch({ officeWhatsapp: "", officeAddress: "", officeMapUrl: "" }))).status === 403);
for (const bad of ["javascript:alert(1)", "http://maps.app.goo.gl/abc", "https://evil.example/maps", "https://google.com.evil.example/maps", "https://goo.gl/abc"]) {
  check("a non Google Maps link is refused: " + bad, (await senior.api("/api/office?target=contact", patch({ officeWhatsapp: "", officeAddress: "", officeMapUrl: bad }))).status === 400);
}
for (const good of ["https://www.google.com/maps/place/Amman", "https://maps.google.com/?q=31.9,35.9", "https://www.google.jo/maps/@31.9,35.9,15z"]) {
  check("a Google Maps link is accepted: " + good, (await senior.api("/api/office?target=contact", patch({ officeWhatsapp: "", officeAddress: "", officeMapUrl: good }))).status === 200);
}
const mapLink = "https://maps.app.goo.gl/abc123";
check("contact details save", (await senior.api("/api/office?target=contact", patch({ officeWhatsapp: "+962 79 123 4567", officeAddress: "عمان، العبدلي", officeMapUrl: mapLink }))).status === 200);
const publicOffice = await (await fetch(base + "/api/office/public")).json();
check("the public site reads them without a session", publicOffice.whatsapp === "+962 79 123 4567" && publicOffice.mapUrl === mapLink && publicOffice.address === "عمان، العبدلي");
check("the public route exposes contact fields only", Object.keys(publicOffice).sort().join() === "address,mapUrl,phone,whatsapp");

const health = await fetch(base + "/api/health");
check("health reports the database and RLS", health.status === 200 && (await health.json()).rlsEnforced === true);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
