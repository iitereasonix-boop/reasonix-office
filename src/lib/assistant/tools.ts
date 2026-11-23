import { DraftKind, type Prisma } from "@prisma/client";
import { z } from "zod";
import { logAudit, withDatabaseAccess, type SafeUser } from "@/lib/auth";
import { unverifiedFacts } from "@/lib/assistant/facts";
import { unseal } from "@/lib/crypto";
import { normalizeArabic, scoreText, searchTerms, snippet } from "@/lib/text";

export type Source = {
  id: string;
  kind: "document" | "hearing" | "judgment" | "case" | "law";
  label: string;
  detail?: string;
  documentId?: string;
  page?: number;
  href?: string;
};

export type DraftRef = { id: string; title: string; href: string };

export type ToolContext = { user: SafeUser; sources: Source[]; drafts: DraftRef[]; evidence: string[] };

const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman" }).format(value).replaceAll("-", "/");
const stamp = (value: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" }).format(value);

/** Registers a record the model may cite. The id comes from here, so citations can be verified. */
function cite(context: ToolContext, source: Omit<Source, "id">) {
  const existing = context.sources.find((item) => item.kind === source.kind && item.label === source.label && item.page === source.page);
  if (existing) return existing.id;
  const id = `S${context.sources.length + 1}`;
  context.sources.push({ ...source, id });
  return id;
}

const db = <T,>(context: ToolContext, callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
  withDatabaseAccess(context.user, callback);

async function resolveCase(context: ToolContext, reference: string) {
  const legalCase = await db(context, (tx) =>
    tx.legalCase.findFirst({
      where: { deletedAt: null, OR: [{ id: reference }, { caseNumber: reference.trim() }] },
      select: { id: true, caseNumber: true, clientId: true },
    }),
  );
  if (!legalCase) throw new ToolError(`لا توجد قضية متاحة لهذا المستخدم بالمرجع ${reference}.`);
  return legalCase;
}

export class ToolError extends Error {}

const definitions = {
  find_case: {
    description: "Find cases by case number, subject or client name. Use this first when the user names a case or client loosely.",
    input: z.object({ query: z.string().min(1).max(200) }),
    run: async (context: ToolContext, { query }: { query: string }) => {
      const cases = await db(context, (tx) =>
        tx.legalCase.findMany({
          where: { deletedAt: null },
          select: { id: true, caseNumber: true, title: true, type: true, status: true, client: { select: { name: true } } },
          take: 500,
        }),
      );
      const terms = searchTerms(query);
      return cases
        .map((item) => ({ item, score: scoreText(normalizeArabic(`${item.caseNumber} ${item.title} ${item.client.name}`), terms) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(({ item }) => ({ case_id: item.id, case_number: item.caseNumber, title: item.title, client: item.client.name, type: item.type, status: item.status }));
    },
  },
  get_case_file: {
    description: "Read a full case file: parties, court, status, hearings with decisions, judgments, tasks, drafts, and the document list. Accepts a case id or exact case number.",
    input: z.object({ case_ref: z.string().min(1).max(120) }),
    run: async (context: ToolContext, { case_ref }: { case_ref: string }) => {
      const { id } = await resolveCase(context, case_ref);
      const file = await db(context, (tx) =>
        tx.legalCase.findFirstOrThrow({
          where: { id },
          include: {
            client: { select: { id: true, name: true, phone: true } },
            assignedLawyer: { select: { name: true } },
            traineeLawyer: { select: { name: true } },
            hearings: { where: { deletedAt: null }, orderBy: { startsAt: "asc" } },
            judgments: { where: { deletedAt: null }, orderBy: { decidedAt: "desc" } },
            tasks: { where: { deletedAt: null, completedAt: null }, orderBy: { dueAt: "asc" }, include: { assignee: { select: { name: true } } } },
            drafts: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, createdAt: true } },
            documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, pageCount: true, extraction: true, createdAt: true } },
          },
        }),
      );
      const canSeePrivate = context.user.canViewPrivateNotes;
      return {
        source: cite(context, { kind: "case", label: `ملف القضية ${file.caseNumber}`, detail: file.title, href: `/app/cases/${file.id}` }),
        case_id: file.id,
        case_number: file.caseNumber,
        title: file.title,
        summary: file.summary,
        type: file.type,
        court_level: file.court,
        court_city: file.courtCity,
        status: file.status,
        client: file.client,
        opposing_parties: file.opposingParties,
        assigned_lawyer: file.assignedLawyer.name,
        trainee_lawyer: file.traineeLawyer?.name ?? null,
        private_notes: canSeePrivate ? unseal(file.privateNotes) : "محجوبة عن هذا المستخدم",
        hearings: file.hearings.map((hearing) => ({
          source: cite(context, { kind: "hearing", label: `جلسة ${day(hearing.startsAt)}`, detail: `سجل الجلسات — القضية ${file.caseNumber}`, href: `/app/cases/${file.id}` }),
          at: stamp(hearing.startsAt),
          purpose: hearing.purpose,
          courtroom: hearing.courtroom,
          judge: hearing.judge,
          decision: hearing.decision,
          next_session: hearing.nextStartsAt ? stamp(hearing.nextStartsAt) : null,
        })),
        judgments: file.judgments.map((judgment) => ({
          source: cite(context, { kind: "judgment", label: judgment.title, detail: `سجل الأحكام — ${day(judgment.decidedAt)}`, href: "/app/judgments" }),
          title: judgment.title,
          decided_at: day(judgment.decidedAt),
          summary: judgment.summary,
          appeal_deadline_entered_by_office: judgment.appealDeadline ? day(judgment.appealDeadline) : null,
        })),
        open_tasks: file.tasks.map((task) => ({ title: task.title, due: task.dueAt ? day(task.dueAt) : null, assignee: task.assignee.name })),
        drafts: file.drafts.map((draft) => ({ title: draft.title, status: draft.status, created: day(draft.createdAt) })),
        documents: file.documents.map((document) => ({ document_id: document.id, title: document.title, pages: document.pageCount, readable: document.extraction === "READY" })),
      };
    },
  },
  list_hearings: {
    description: "List hearings between two dates across all cases this user may see. Dates are YYYY-MM-DD; defaults to the next 30 days.",
    input: z.object({ from: z.string().date().optional(), to: z.string().date().optional() }),
    run: async (context: ToolContext, { from, to }: { from?: string; to?: string }) => {
      const start = from ? new Date(`${from}T00:00:00+03:00`) : new Date();
      const end = to ? new Date(`${to}T23:59:59+03:00`) : new Date(start.getTime() + 30 * 86_400_000);
      const hearings = await db(context, (tx) =>
        tx.hearing.findMany({
          where: { deletedAt: null, startsAt: { gte: start, lte: end }, legalCase: { deletedAt: null } },
          include: { legalCase: { select: { id: true, caseNumber: true, title: true, client: { select: { name: true } } } } },
          orderBy: { startsAt: "asc" },
          take: 60,
        }),
      );
      return hearings.map((hearing) => ({
        source: cite(context, { kind: "hearing", label: `جلسة ${day(hearing.startsAt)}`, detail: `سجل الجلسات — القضية ${hearing.legalCase.caseNumber}`, href: `/app/cases/${hearing.legalCase.id}` }),
        at: stamp(hearing.startsAt),
        case_number: hearing.legalCase.caseNumber,
        title: hearing.legalCase.title,
        client: hearing.legalCase.client.name,
        purpose: hearing.purpose,
      }));
    },
  },
  find_client: {
    description: "Find a client by name or phone and list their cases.",
    input: z.object({ query: z.string().min(1).max(160) }),
    run: async (context: ToolContext, { query }: { query: string }) => {
      const clients = await db(context, (tx) =>
        tx.client.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, phone: true, cases: { where: { deletedAt: null }, select: { id: true, caseNumber: true, title: true } } },
          take: 1000,
        }),
      );
      const terms = searchTerms(query);
      return clients
        .map((client) => ({ client, score: scoreText(normalizeArabic(`${client.name} ${client.phone}`), terms) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(({ client }) => ({ client_id: client.id, name: client.name, phone: client.phone, cases: client.cases }));
    },
  },
  search_documents: {
    description: "Search the text of uploaded case documents and return matching pages with excerpts. Pass case_ref to stay inside one case.",
    input: z.object({ query: z.string().min(1).max(300), case_ref: z.string().max(120).optional() }),
    run: async (context: ToolContext, { query, case_ref }: { query: string; case_ref?: string }) => {
      const caseId = case_ref ? (await resolveCase(context, case_ref)).id : undefined;
      const terms = searchTerms(query);
      if (!terms.length) return [];
      const pages = await db(context, (tx) =>
        tx.documentPage.findMany({
          where: {
            document: { deletedAt: null, ...(caseId ? { caseId } : {}) },
            OR: terms.map((term) => ({ searchText: { contains: term } })),
          },
          select: { page: true, text: true, searchText: true, document: { select: { id: true, title: true, legalCase: { select: { caseNumber: true } } } } },
          take: 300,
        }),
      );
      return pages
        .map((page) => ({ page, score: scoreText(page.searchText, terms) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(({ page }) => ({
          source: cite(context, { kind: "document", label: page.document.title, detail: `ص ${page.page}`, documentId: page.document.id, page: page.page }),
          document_id: page.document.id,
          document: page.document.title,
          case_number: page.document.legalCase.caseNumber,
          page: page.page,
          untrusted_document_text: snippet(page.text, terms),
        }));
    },
  },
  read_document_page: {
    description: "Read one page of a document in full. Use this before relying on an excerpt.",
    input: z.object({ document_id: z.string().min(1), page: z.number().int().min(1) }),
    run: async (context: ToolContext, { document_id, page }: { document_id: string; page: number }) => {
      const found = await db(context, (tx) =>
        tx.documentPage.findFirst({
          where: { documentId: document_id, page, document: { deletedAt: null } },
          select: { text: true, document: { select: { title: true, pageCount: true } } },
        }),
      );
      if (!found) throw new ToolError("هذه الصفحة غير موجودة أو غير متاحة لهذا المستخدم.");
      return {
        source: cite(context, { kind: "document", label: found.document.title, detail: `ص ${page}`, documentId: document_id, page }),
        document: found.document.title,
        page,
        total_pages: found.document.pageCount,
        untrusted_document_text: found.text,
      };
    },
  },
  search_legal_texts: {
    description: "Search Jordanian laws the office uploaded to its library. This is the only allowed source for any statute or article. An empty result means the text is not in the library.",
    input: z.object({ query: z.string().min(1).max(300) }),
    run: async (context: ToolContext, { query }: { query: string }) => {
      const terms = searchTerms(query);
      if (!terms.length) return [];
      const articles = await db(context, (tx) =>
        tx.legalArticle.findMany({
          where: { source: { deletedAt: null }, OR: terms.map((term) => ({ searchText: { contains: term } })) },
          select: { number: true, text: true, searchText: true, source: { select: { title: true, reference: true } } },
          take: 200,
        }),
      );
      return articles
        .map((article) => ({ article, score: scoreText(article.searchText, terms) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map(({ article }) => ({
          source: cite(context, { kind: "law", label: `${article.source.title} — المادة ${article.number}`, detail: article.source.reference, href: "/app/library" }),
          law: article.source.title,
          article: article.number,
          official_reference: article.source.reference,
          text: article.text,
        }));
    },
  },
  save_legal_draft: {
    description: "Save a memo, letter, notice or report as a draft for the lawyer to review. Call it only when the user asked for a draft. Nothing is filed or sent. The body may carry [S#] citation markers.",
    input: z.object({
      case_ref: z.string().min(1).max(120),
      title: z.string().min(2).max(200),
      kind: z.nativeEnum(DraftKind),
      body: z.string().min(20).max(30000),
    }),
    run: async (context: ToolContext, input: { case_ref: string; title: string; kind: DraftKind; body: string }) => {
      const { id: caseId, caseNumber } = await resolveCase(context, input.case_ref);
      const cited = context.sources.filter((source) => input.body.includes(`[${source.id}]`));
      if (!cited.length) throw new ToolError("رُفض الحفظ: يجب أن تستند المسودة إلى مصدر واحد على الأقل بعلامة [S#] أرجعتها الأدوات.");
      const invented = unverifiedFacts(input.body, context.evidence);
      if (invented.length) throw new ToolError(`رُفض الحفظ: هذه القيم غير موجودة في المصادر: ${invented.join("، ")}. احذفها، واكتب مكان أي سند قانوني: [السند القانوني يضيفه المحامي].`);
      const draft = await db(context, (tx) =>
        tx.legalDraft.create({
          data: {
            caseId,
            title: input.title,
            kind: input.kind,
            body: input.body.replace(/\s*\[S\d+\]/g, ""),
            generatedByAi: true,
            createdById: context.user.id,
            sources: cited as unknown as Prisma.InputJsonValue,
          },
        }),
      );
      await logAudit(context.user, "AI_DRAFT_CREATED", "LegalDraft", draft.id, { caseNumber }, caseId);
      context.drafts.push({ id: draft.id, title: draft.title, href: `/app/documents?tab=drafts&draft=${draft.id}` });
      return { saved: true, draft_id: draft.id, status: "بانتظار مراجعة المحامي واعتماده" };
    },
  },
  save_whatsapp_draft: {
    description: "Save a WhatsApp message to a client as a draft. It is not sent: the senior lawyer must approve it first. Call it only when the user asked for a message or reminder.",
    input: z.object({ client_id: z.string().min(1), case_ref: z.string().max(120).optional(), body: z.string().min(2).max(2000) }),
    run: async (context: ToolContext, input: { client_id: string; case_ref?: string; body: string }) => {
      const linked = input.case_ref ? await resolveCase(context, input.case_ref) : null;
      if (linked && linked.clientId !== input.client_id) throw new ToolError("هذه القضية لا تخص العميل المحدد.");
      const message = await db(context, async (tx) => {
        const client = await tx.client.findFirst({ where: { id: input.client_id, deletedAt: null }, select: { name: true } });
        if (!client) throw new ToolError("العميل غير موجود أو غير متاح لهذا المستخدم.");
        const created = await tx.message.create({
          data: { clientId: input.client_id, caseId: linked?.id, body: input.body.replace(/\s*\[S\d+\]/g, ""), generatedByAi: true },
        });
        return { id: created.id, client: client.name };
      });
      await logAudit(context.user, "AI_MESSAGE_DRAFT_CREATED", "Message", message.id, undefined, linked?.id);
      context.drafts.push({ id: message.id, title: `رسالة واتساب إلى ${message.client}`, href: "/app/whatsapp" });
      return { saved: true, status: "مسودة بانتظار الاعتماد، ولم تُرسل" };
    },
  },
};

type ToolName = keyof typeof definitions;

export const assistantTools = (Object.keys(definitions) as ToolName[]).map((name) => {
  const schema = z.toJSONSchema(definitions[name].input) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name,
    description: definitions[name].description,
    eager_input_streaming: true,
    input_schema: { ...schema, type: "object" as const },
  };
});

export const toolProgress: Record<string, string> = {
  find_case: "يبحث عن القضية…",
  get_case_file: "يقرأ ملف القضية…",
  list_hearings: "يراجع سجل الجلسات…",
  find_client: "يبحث في سجل العملاء…",
  search_documents: "يبحث في المستندات…",
  search_legal_texts: "يبحث في المكتبة القانونية…",
  read_document_page: "يقرأ صفحة من المستند…",
  save_legal_draft: "يحفظ المسودة للمراجعة…",
  save_whatsapp_draft: "يحفظ مسودة الرسالة…",
};

/** Returns JSON for the model; an unknown tool or bad input comes back as a tool error, not a crash. */
export async function runTool(context: ToolContext, name: string, input: unknown) {
  if (!(name in definitions)) throw new ToolError(`أداة غير معروفة: ${name}`);
  const definition = definitions[name as ToolName];
  const parsed = definition.input.safeParse(input);
  if (!parsed.success) throw new ToolError(`مدخلات غير صالحة للأداة ${name}: ${parsed.error.message}`);
  const run = definition.run as (context: ToolContext, input: unknown) => Promise<unknown>;
  const result = JSON.stringify(await run(context, parsed.data));
  context.evidence.push(result);
  return result;
}
