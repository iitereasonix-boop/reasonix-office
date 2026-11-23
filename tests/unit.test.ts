import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { verifyCitations } from "../src/lib/assistant/agent";
import { unverifiedFacts } from "../src/lib/assistant/facts";
import { candidateProviders, chooseModel, providerById, stripProviderMarkup } from "../src/lib/assistant/providers";
import { maskId, seal, unseal } from "../src/lib/crypto";
import { ammanDayKey, ammanDayStart, insideQuietWindow, nextSendTime } from "../src/lib/dates";
import { mojCaseNumber, proposeDeadline, ruleApplies, type Closure } from "../src/lib/deadlines";
import { buildCalendar } from "../src/lib/ics";
import { hearingDate, verifyExtraction } from "../src/lib/intake";
import { splitArticles } from "../src/lib/legal";
import { findConflicts, matchClient, nameSimilarity } from "../src/lib/matching";
import { normalizeArabic, searchTerms, whatsappNumber } from "../src/lib/text";
import { digitsOnly, fillTemplate, isStopRequest, validSignature } from "../src/lib/whatsapp";
import { detectOfficePhotoMimeType } from "../src/lib/office-photo";

const rule = { id: "r1", name: "قاعدة اختبار", days: 30, base: "NOTIFICATION" as const, legalBasis: "سند اختبار" };
const decided = new Date("2026-10-01T06:00:00Z");
const notified = new Date("2026-10-11T06:00:00Z");

test("deadline counts from the notification date and explains the rule", () => {
  const result = proposeDeadline(rule, decided, notified);
  assert.equal(ammanDayKey(result!.deadline), "2026-11-10");
  assert.match(result!.snapshot.explanation, /30 يوماً من تاريخ التبليغ/);
  assert.match(result!.snapshot.explanation, /سند اختبار/);
});

test("deadline counts from the decision date when the rule says so", () => {
  const result = proposeDeadline({ ...rule, base: "DECISION" }, decided, notified);
  assert.equal(ammanDayKey(result!.deadline), "2026-10-31");
});

test("a notification-based rule refuses to guess without the date", () => {
  assert.equal(proposeDeadline(rule, decided, null), null);
});

test("a deadline crossing a month and year stays exact", () => {
  const result = proposeDeadline({ ...rule, days: 60, base: "DECISION" }, new Date("2026-12-15T06:00:00Z"));
  assert.equal(ammanDayKey(result!.deadline), "2027-02-13");
});

const eid: Closure = { name: "عيد اختبار", from: "2026-11-10", to: "2026-11-12", kind: "HOLIDAY" };
const vacation: Closure = { name: "عطلة قضائية", from: "2026-10-20", to: "2026-10-29", kind: "JUDICIAL_VACATION" };

test("holidays change nothing unless the rule says so", () => {
  const result = proposeDeadline(rule, decided, notified, [eid, vacation]);
  assert.equal(ammanDayKey(result!.deadline), "2026-11-10");
});

test("a last day on a holiday moves to the next working day", () => {
  // 30 days from 2026-10-11 is Tuesday 2026-11-10; the holiday runs to Thursday, then Friday and Saturday are the weekend.
  const result = proposeDeadline({ ...rule, rollForward: true }, decided, notified, [eid]);
  assert.equal(ammanDayKey(result!.deadline), "2026-11-15");
  assert.match(result!.snapshot.explanation, /نُقل آخر يوم من 2026\/11\/10 إلى 2026\/11\/15/);
  assert.match(result!.snapshot.explanation, /عيد اختبار/);
});

test("a last day on a Friday moves past the weekend", () => {
  const result = proposeDeadline({ ...rule, days: 33, rollForward: true }, decided, notified);
  assert.equal(ammanDayKey(result!.deadline), "2026-11-15");
});

test("the count pauses during the judicial vacation when the rule says so", () => {
  const result = proposeDeadline({ ...rule, pauseInVacation: true }, decided, notified, [vacation]);
  assert.equal(ammanDayKey(result!.deadline), "2026-11-20");
  assert.match(result!.snapshot.explanation, /وقف العدّ 10 يوماً/);
});

test("pausing and moving combine", () => {
  const result = proposeDeadline({ ...rule, pauseInVacation: true, rollForward: true, days: 31 }, decided, notified, [vacation]);
  assert.equal(ammanDayKey(result!.deadline), "2026-11-22");
});

test("the Ministry of Justice case number reads number/year", () => {
  assert.equal(mojCaseNumber("343", 2021), "343/2021");
  assert.equal(mojCaseNumber("343", null), null);
});

test("rules apply only to their case type and court", () => {
  assert.equal(ruleApplies({ caseType: "CIVIL", court: null }, "CIVIL", "APPEAL"), true);
  assert.equal(ruleApplies({ caseType: "CIVIL", court: null }, "CRIMINAL", "APPEAL"), false);
  assert.equal(ruleApplies({ caseType: null, court: "APPEAL" }, "CIVIL", "CASSATION"), false);
});

test("Arabic spelling variants match", () => {
  assert.equal(normalizeArabic("أحمد عليّ"), normalizeArabic("احمد علي"));
  assert.equal(normalizeArabic("مؤسسة ليلى"), normalizeArabic("موسسه ليلي"));
  assert.ok(searchTerms("الشركة في عمّان").includes("شركه"));
});

test("office photo detection accepts only JPEG, PNG, and WebP signatures", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = new Uint8Array(12);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50], 8);

  assert.equal(detectOfficePhotoMimeType(jpeg), "image/jpeg");
  assert.equal(detectOfficePhotoMimeType(png), "image/png");
  assert.equal(detectOfficePhotoMimeType(webp), "image/webp");
  assert.equal(detectOfficePhotoMimeType(new Uint8Array([0x47, 0x49, 0x46])), null);
});

const clients = [
  { id: "1", name: "أحمد محمد علي" },
  { id: "2", name: "شركة النور للمقاولات" },
  { id: "3", name: "خالد يوسف" },
];

test("an exact name in different spelling is a confident match", () => {
  const match = matchClient("احمد محمد علي", clients);
  assert.equal(match.client?.id, "1");
  assert.equal(match.confident, true);
});

test("a partial name needs review and is not confident", () => {
  const match = matchClient("أحمد علي العمري", clients);
  assert.equal(match.confident, false);
});

test("two near-identical clients are never decided automatically", () => {
  const match = matchClient("محمد سالم", [{ id: "a", name: "محمد سالم" }, { id: "b", name: "محمد سالمي" }]);
  assert.equal(match.confident, false);
  assert.match(match.reason, /أكثر من عميل/);
});

test("an unknown name matches nobody", () => {
  const match = matchClient("سمير طه", clients);
  assert.equal(match.client, null);
  assert.equal(match.confident, false);
});

test("a missing name is not guessed", () => {
  assert.equal(matchClient(null, clients).client, null);
});

test("word order does not hide a match", () => {
  assert.ok(nameSimilarity("علي محمد أحمد", "أحمد محمد علي") > 0.95);
});

test("conflict check flags an opposing party who is a client", () => {
  const hits = findConflicts([{ name: "خالد يوسف", role: "opposing" }], clients, []);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "client");
});

test("conflict check flags a new client who was on the other side", () => {
  const hits = findConflicts([{ name: "شركة النور للمقاولات", role: "client" }], [], [{ id: "c", caseNumber: "2026/124", clientName: "أحمد", opposingParties: ["شركة النور للمقاولات"] }]);
  assert.equal(hits[0].caseNumber, "2026/124");
  assert.equal(hits[0].kind, "opposing");
});

test("conflict check stays quiet for unrelated names", () => {
  assert.equal(findConflicts([{ name: "سمير طه", role: "opposing" }], clients, []).length, 0);
});

const paper = "محكمة بداية عمان\nالقضية رقم 2026/300\nالمدعي: أحمد محمد علي\nالجلسة القادمة 2026-12-01";
const field = (value: string | null, quote: string | null) => ({ value, quote });

test("an extraction with a real quote is kept", () => {
  const result = verifyExtraction({ client_name: field("أحمد محمد علي", "المدعي: أحمد محمد علي"), case_number: field("2026/300", "القضية رقم 2026/300"), court: field(null, null), hearing_date: field(null, null) }, paper);
  assert.equal(result?.case_number.value, "2026/300");
  assert.equal(result?.court.value, null);
});

test("a value whose quote is not in the file is dropped", () => {
  const result = verifyExtraction({ client_name: field("سمير", "المدعي: سمير"), case_number: field("9999/1", "رقم 9999/1"), court: field(null, null), hearing_date: field(null, null) }, paper);
  assert.equal(result?.client_name.value, null);
  assert.equal(result?.case_number.value, null);
});

test("output that breaks the schema is rejected outright", () => {
  assert.equal(verifyExtraction({ client_name: "أحمد" }, paper), null);
  assert.equal(verifyExtraction({ client_name: field(null, null), case_number: field(null, null), court: field(null, null), hearing_date: field(null, null), extra: 1 }, paper), null);
});

test("hearing dates must be well formed", () => {
  assert.equal(hearingDate("next week"), null);
  assert.equal(hearingDate("2026-12-01")?.toISOString(), "2026-12-01T06:00:00.000Z");
});

test("citations not returned by a tool are removed", () => {
  const { text, cited } = verifyCitations("قرار [S1] واختلاق [S9]", [{ id: "S1", kind: "case", label: "ملف" }]);
  assert.equal(text, "قرار [S1] واختلاق");
  assert.equal(cited.length, 1);
});

test("invented dates, case numbers and articles are caught", () => {
  const facts = unverifiedFacts("جلسة 2026/11/18 والقضية 2026/999 وفق المادة 77", ['{"at":"2026/11/18"}', "2026/124"]);
  assert.deepEqual(facts, ["2026/999", "77"]);
});

test("article numbers are caught in every common spelling", () => {
  for (const text of ["المادة (97) من القانون", "المادة 97", "مادة رقم 97", "المادة ٩٧", "وفق المادة رقم (97)"]) {
    assert.deepEqual(unverifiedFacts(text, ["لا شيء"]), ["97"], text);
  }
  assert.deepEqual(unverifiedFacts("المادة (97)", ['{"article":"97"}']), []);
});

test("a date is known in either spelling the tools use", () => {
  assert.deepEqual(unverifiedFacts("الجلسة 2026/11/18", ['{"at":"18/11/2026, 09:30"}']), []);
  assert.deepEqual(unverifiedFacts("الجلسة 2026/11/18", ['{"at":"2026\\/11\\/18"}']), []);
  assert.deepEqual(unverifiedFacts("الجلسة 2026/11/19", ['{"at":"18/11/2026, 09:30"}']), ["2026/11/19"]);
});

test("law text splits on article headings", () => {
  const articles = splitArticles("مادة 1\nنص أول\nالمادة (٢)\nنص ثان");
  assert.deepEqual(articles.map((article) => article.number), ["1", "2"]);
  assert.match(articles[1].text, /نص ثان/);
});

test("quiet hours and rescheduling follow Amman time", () => {
  assert.equal(insideQuietWindow(8, 9, 20), false);
  assert.equal(insideQuietWindow(20, 9, 20), false);
  assert.equal(insideQuietWindow(9, 9, 20), true);
  const late = new Date("2026-11-02T20:00:00Z"); // 23:00 in Amman
  assert.equal(ammanDayKey(nextSendTime(late, 9, 20)), "2026-11-03");
  assert.equal(nextSendTime(late, 9, 20).toISOString(), "2026-11-03T06:00:00.000Z");
});

test("the Amman day does not depend on the server's zone", () => {
  assert.equal(ammanDayStart(new Date("2026-11-02T22:30:00Z")).toISOString(), "2026-11-02T21:00:00.000Z");
});

test("field encryption round-trips and leaves no plain text", () => {
  process.env.FIELD_ENCRYPTION_KEY = "test-key";
  const sealed = seal("9000000001");
  assert.ok(!sealed.includes("9000000001"));
  assert.notEqual(sealed, seal("9000000001"));
  assert.equal(unseal(sealed), "9000000001");
  assert.equal(unseal("legacy-plain"), "legacy-plain");
  assert.equal(maskId("9000000001"), "••••••0001");
});

test("a key goes only to the providers it could belong to", () => {
  const ids = (key: string) => candidateProviders(key).map((provider) => provider.id);
  assert.deepEqual(ids("cohere_abc"), ["cohere"]);
  assert.deepEqual(ids("sk-or-abc"), ["openrouter"]);
  assert.deepEqual(ids("sk-abc"), ["openai", "deepseek"]);
  assert.deepEqual(ids("gsk_abc"), ["groq"]);
  assert.deepEqual(ids("AIzaabc"), ["gemini"]);
  assert.deepEqual(ids("plainkey"), ["cohere", "mistral"]);
});

test("the best chat model is chosen, never an embedding model", () => {
  assert.equal(chooseModel(providerById("cohere")!, ["embed-v4", "command-r-plus-08-2024", "command-a-03-2025", "command-a-plus-05-2026"]), "command-a-plus-05-2026");
  assert.equal(chooseModel(providerById("gemini")!, ["models/gemini-2.5-flash", "models/text-embedding-004"]), "gemini-2.5-flash");
  assert.equal(chooseModel(providerById("openai")!, ["text-embedding-3", "whisper-1"]), null);
});

test("provider citation tags never reach the text", () => {
  assert.equal(stripProviderMarkup("القضية <co>2026/124</co: 0:[0]> و<co: 1>نص</co: 1>"), "القضية 2026/124 ونص");
});

test("WhatsApp numbers always carry the country code", () => {
  for (const phone of ["0791234567", "079 123 4567", "791234567", "+962791234567", "00962791234567", "962791234567"]) {
    assert.equal(whatsappNumber(phone), "962791234567", phone);
  }
  assert.equal(whatsappNumber("+966501234567"), "966501234567");
});

test("WhatsApp helpers", () => {
  assert.equal(fillTemplate("{{1}} / {{2}}", ["أ", "ب"]), "أ / ب");
  assert.equal(digitsOnly("+962 79-000"), "96279000");
  assert.equal(isStopRequest(" STOP "), true);
  assert.equal(isStopRequest("إلغاء"), true);
  assert.equal(isStopRequest("شكراً"), false);
});

test("webhook signatures are verified", () => {
  process.env.WHATSAPP_APP_SECRET = "secret";
  const good = `sha256=${createHmac("sha256", "secret").update("body").digest("hex")}`;
  assert.equal(validSignature("body", good), true);
  assert.equal(validSignature("tampered", good), false);
  assert.equal(validSignature("body", null), false);
});

test("ICS output is well formed and escapes text", () => {
  const ics = buildCalendar([{ id: "h1", start: new Date("2026-11-18T06:30:00Z"), title: "جلسة, اختبار" }], new Date("2026-11-01T00:00:00Z"));
  assert.match(ics, /DTSTART:20261118T063000Z/);
  assert.match(ics, /SUMMARY:جلسة\\, اختبار/);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR") && ics.endsWith("END:VCALENDAR"));
});

test("hours are priced in fils without drift", async () => {
  const { timeValueCents, formatMinutes } = await import("../src/lib/billing");
  assert.equal(timeValueCents(100, 30), 5000);
  assert.equal(timeValueCents(20, 35.5), 1183);
  assert.equal(timeValueCents(0, 50), 0);
  assert.equal(formatMinutes(95), "1 س 35 د");
  assert.equal(formatMinutes(120), "2 س");
  assert.equal(formatMinutes(15), "15 د");
});
