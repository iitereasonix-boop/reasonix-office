import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Role, type Prisma } from "@prisma/client";
import { chromium, type Page } from "playwright";
import { normalizeArabic } from "../src/lib/text";
import { officialArticleText } from "../src/lib/legal";
import { prisma } from "../src/lib/prisma";

const PORTAL_URL = "https://www.lob.gov.jo";
const SEARCH_PAGE_DELAY_MS = 500;
const CHECKPOINT_PATH = join(process.cwd(), ".jordanian-laws-sync.json");
const IMPORTER_ACTOR_ID = "official-law-importer";
const searchData = {
  LegislationType: -1,
  LegislationTitle: "",
  LegislationNumber: -1,
  LegislationYear: -1,
  LegislationYearTo: -1,
  LegislationYearFrom: -1,
  LegislationStatus: -1,
  MatchingSearch: 0,
  ArticleSearch: 0,
  ArticleText: "",
  Issuer: 0,
  CourtType: 0,
  FromHome: 0,
};

type PortalRecord = {
  pmk_ID: number;
  Name: string;
  Number: number;
  Year: number;
  Status_AR: string;
  Type: number;
  TypeArName: string;
  isMod: boolean;
};

type PortalArticle = { Article_Number?: string | number | null; Article?: string | null };
type PortalLaw = {
  Name?: string;
  Nunmber?: number;
  Year?: number;
  Magazine_Date?: string | null;
  Magazine_Number?: string | number | null;
  Magazine_Page_Number?: string | number | null;
  Introduction?: string | null;
  Replaced_For?: string | number | null;
  ModLeg?: string | number | null;
  ModLegType?: string | number | null;
};

type Checkpoint = { expectedTotal: number; completedKeys: string[] };

function sourceKey(record: PortalRecord) {
  return `${record.Type}:${record.pmk_ID}`;
}

function sourceUrl(record: PortalRecord) {
  return `${PORTAL_URL}/?v=3&lang=ar#!/LegislationDetails?LegislationID=${record.pmk_ID}&LegislationType=${record.Type}&isMod=${record.isMod}`;
}

function sourceReference(record: PortalRecord, law: PortalLaw) {
  const number = law.Nunmber ?? record.Number;
  const year = law.Year ?? record.Year;
  const parts = [`ديوان التشريع والرأي — ${record.TypeArName}`];
  if (number) parts.push(`رقم ${number}`);
  if (year) parts.push(`لسنة ${year}`);
  parts.push(`الحالة: ${record.Status_AR}`);
  if (law.Magazine_Number) {
    parts.push(`الجريدة الرسمية رقم ${law.Magazine_Number}`);
    if (law.Magazine_Date) parts.push(`بتاريخ ${law.Magazine_Date}`);
    if (law.Magazine_Page_Number) parts.push(`صفحة ${law.Magazine_Page_Number}`);
  }
  return parts.join(" — ");
}

async function loadCheckpoint(): Promise<Checkpoint | null> {
  try {
    return JSON.parse(await readFile(CHECKPOINT_PATH, "utf8")) as Checkpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function saveCheckpoint(checkpoint: Checkpoint) {
  const temporary = `${CHECKPOINT_PATH}.tmp`;
  await writeFile(temporary, JSON.stringify(checkpoint), "utf8");
  await rename(temporary, CHECKPOINT_PATH);
}

async function callPortal<T>(page: Page, method: string, parameters: Record<string, unknown>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const result = await page.evaluate(
        ({ methodName, args }) =>
          new Promise<{ ok: boolean; value?: unknown; error?: unknown }>((resolve) => {
            const scope = (window as Window & { PageScope?: { Server?: (...values: unknown[]) => void } }).PageScope;
            if (!scope?.Server) {
              resolve({ ok: false, error: "Portal session is not ready." });
              return;
            }
            scope.Server(
              methodName,
              args,
              (value: unknown) => resolve({ ok: true, value }),
              undefined,
              (error: unknown) => resolve({ ok: false, error }),
            );
          }),
        { methodName: method, args: parameters },
      );
      if (result.ok) return result.value as T;
      lastError = result.error;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await delay(1_000 * attempt);
  }
  throw new Error(`تعذر جلب ${method} من بوابة ديوان التشريع والرأي بعد 4 محاولات: ${JSON.stringify(lastError)}`);
}

async function withImporterAccess<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${IMPORTER_ACTOR_ID}, true), set_config('app.user_role', ${Role.SENIOR_LAWYER}, true), set_config('app.private_notes', 'false', true), set_config('app.national_id', 'false', true), set_config('app.client_id', '', true)`;
    return callback(tx);
  });
}

async function syncRecord(record: PortalRecord, page: Page) {
  const data = await callPortal<{ Legislation?: PortalLaw[]; Articles?: PortalArticle[] }>(page, "GetLegislationDetails", {
    LangID: 0,
    LegislationID: record.pmk_ID,
    LegislationType: record.Type,
    isMod: record.isMod,
  });
  const law = data.Legislation?.[0];
  if (!law || !Array.isArray(data.Articles)) {
    throw new Error(`استجابة تفاصيل غير مكتملة للتشريع ${sourceKey(record)}.`);
  }
  // قوانين التعديل (ModLegType = 2) تُنشر بلا مواد ولا مقدمة؛ مضمونها القانوني يُقاس من التشريع الأصلي الذي تعدّله.
  // شرط عدد المواد الصفر ضروري: بعض قوانين الموازنة العامة ModLegType=2 ومعها مواد كاملة.
  const skipReason = Number(law.ModLegType) === 2 && data.Articles.length === 0
    ? `law_is_amendment; replaced_for=${law.Replaced_For ?? ""}`
    : null;
  const articles = data.Articles
    .map((article, index) => ({
      number: String(article.Article_Number ?? index + 1),
      text: officialArticleText(String(article.Article ?? "")),
    }))
    .filter((article) => article.text.length > 0);
  if (!articles.length) {
    // لم يُرجع المصدر مواد قابلة للقراءة؛ نحتفظ بالسجل في نقطة الاستئناف بعدم معالجته ونسجل سبب التخطي.
    // Keep the official legislation metadata visible in the library even when its text is unavailable.
  }

  const title = law.Name?.trim() || record.Name?.trim() || `تشريع ${law.Nunmber ?? record.Number ?? record.pmk_ID} لسنة ${law.Year ?? record.Year ?? "غير محدد"}`;
  const reference = sourceReference(record, law);
  const verifiedAt = new Date();
  await withImporterAccess(async (tx) => {
    const source = await tx.legalSource.upsert({
      where: { officialKey: sourceKey(record) },
      create: {
        title,
        reference,
        officialKey: sourceKey(record),
        officialType: record.TypeArName,
        officialStatus: record.Status_AR,
        officialUrl: sourceUrl(record),
        officialNumber: law.Nunmber ?? record.Number ?? null,
        officialYear: law.Year ?? record.Year ?? null,
        lastVerifiedAt: verifiedAt,
        addedById: IMPORTER_ACTOR_ID,
      },
      update: {
        title,
        reference,
        officialType: record.TypeArName,
        officialStatus: record.Status_AR,
        officialUrl: sourceUrl(record),
        officialNumber: law.Nunmber ?? record.Number ?? null,
        officialYear: law.Year ?? record.Year ?? null,
        lastVerifiedAt: verifiedAt,
        deletedAt: null,
      },
      select: { id: true },
    });
    await tx.legalArticle.deleteMany({ where: { sourceId: source.id } });
    await tx.legalArticle.createMany({
      data: articles.map((article) => ({
        ...article,
        searchText: normalizeArabic(article.text),
        sourceId: source.id,
      })),
    });
  });
  return skipReason || !articles.length
    ? { skipped: true, reason: skipReason ?? "no_readable_articles_from_source" }
    : articles.length;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45_000);
    await page.goto(`${PORTAL_URL}/?v=3&lang=ar#!/LegislationLaw`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => typeof (window as Window & { PageScope?: { Server?: unknown } }).PageScope?.Server === "function",
      { timeout: 60_000 },
    );

    const first = await callPortal<{
      TotalResult: number;
      TotalPages: number;
      List: PortalRecord[];
    }>(page, "GetLegislationSearch", { LangID: 0, PageIndex: 1, SearchData: JSON.stringify(searchData) });
    if (!Number.isInteger(first.TotalResult) || !Number.isInteger(first.TotalPages) || !Array.isArray(first.List)) {
      throw new Error("صيغة نتائج البحث من المصدر الرسمي غير متوقعة.");
    }

    const probeId = process.argv.find((argument) => argument.startsWith("--probe-id="))?.slice("--probe-id=".length);
    if (probeId) {
      const [type, id] = probeId.split(":").map(Number);
      if (!Number.isInteger(type) || !Number.isInteger(id)) throw new Error("صيغة --probe-id يجب أن تكون النوع:المعرّف.");
      const detail = await callPortal<{ Legislation?: PortalLaw[]; Articles?: PortalArticle[] }>(page, "GetLegislationDetails", {
        LangID: 0,
        LegislationID: id,
        LegislationType: type,
        isMod: false,
      });
      const law = detail.Legislation?.[0];
      console.info(JSON.stringify({
        id: probeId,
        legislationFields: law ? Object.keys(law) : [],
        skipReason: null,
        title: law?.Name,
        introductionLength: law?.Introduction?.length ?? 0,
        introductionPreview: law?.Introduction?.slice(0, 250),
        modLegType: law?.ModLegType ?? null,
        modLeg: law?.ModLeg ?? null,
        replacedFor: law?.Replaced_For ?? null,
        articlesCount: detail.Articles?.length ?? null,
        articleSamples: detail.Articles?.slice(0, 2).map((article) => ({
          number: article.Article_Number,
          textPreview: officialArticleText(String(article.Article ?? "")).slice(0, 160),
        })),
      }));
      return;
    }

    if (process.argv.includes("--probe")) {
      const record = first.List[0];
      if (!record) throw new Error("البحث الرسمي لم يُرجع أي تشريع.");
      const detail = await callPortal<{ Legislation?: PortalLaw[]; Articles?: PortalArticle[] }>(page, "GetLegislationDetails", {
        LangID: 0,
        LegislationID: record.pmk_ID,
        LegislationType: record.Type,
        isMod: record.isMod,
      });
      const readableArticles = (detail.Articles ?? []).filter((article) => officialArticleText(String(article.Article ?? ""))).length;
      if (!detail.Legislation?.[0] || !readableArticles) throw new Error("تعذر التحقق من تفاصيل ومواد أول تشريع.");
      console.info(JSON.stringify({
        found: first.TotalResult,
        pages: first.TotalPages,
        first: { id: record.pmk_ID, title: detail.Legislation[0].Name ?? record.Name, type: record.TypeArName },
        articles: readableArticles,
        officialUrl: sourceUrl(record),
      }));
      return;
    }

    const checkpoint = await loadCheckpoint();
    if (checkpoint && checkpoint.expectedTotal !== first.TotalResult) {
      throw new Error(`تغير عدد التشريعات من ${checkpoint.expectedTotal} إلى ${first.TotalResult}. راجع ${CHECKPOINT_PATH} قبل المتابعة.`);
    }
    const completedKeys = new Set(checkpoint?.completedKeys ?? []);
    const existingKeys = new Set(await withImporterAccess(async (tx) =>
      (await tx.legalSource.findMany({
        where: { officialKey: { not: null }, deletedAt: null },
        select: { officialKey: true },
      })).flatMap((source) => source.officialKey ? [source.officialKey] : []),
    ));
    console.info(`المصدر الرسمي: ${first.TotalResult} تشريعاً. المكتمل سابقاً: ${completedKeys.size}.`);
    await saveCheckpoint({ expectedTotal: first.TotalResult, completedKeys: [...completedKeys] });

    const pilot = process.argv.includes("--pilot");
    const seenKeys = new Set<string>();
    let seenCount = 0;
    for (let pageIndex = 1; pageIndex <= (pilot ? 1 : first.TotalPages); pageIndex += 1) {
      let records = first.List;
      if (pageIndex > 1) {
        await delay(SEARCH_PAGE_DELAY_MS);
        const result = await callPortal<{ List: PortalRecord[] }>(page, "GetLegislationSearch", {
          LangID: 0,
          PageIndex: pageIndex,
          SearchData: JSON.stringify(searchData),
        });
        records = result.List;
      }
      if (!Array.isArray(records) || records.length === 0) {
        throw new Error(`المصدر الرسمي أعاد صفحة فارغة عند الصفحة ${pageIndex}/${first.TotalPages}.`);
      }
      for (const record of records) {
        const key = sourceKey(record);
        seenCount += 1;
        if (seenKeys.has(key)) {
          console.warn(`تجاوز نتيجة مكررة من المصدر الرسمي: ${key} (${record.Name}).`);
          continue;
        }
        seenKeys.add(key);
        if (completedKeys.has(key) && existingKeys.has(key)) continue;
        await delay(SEARCH_PAGE_DELAY_MS);
        const result = await syncRecord(record, page);
        existingKeys.add(key);
        if (typeof result === "object") {
          completedKeys.add(key);
          console.info(`تخطي ${key} (${record.Name}): ${result.reason}`);
          continue;
        }
        const articleCount = result;
        completedKeys.add(key);
        if (completedKeys.size % 25 === 0) {
          await saveCheckpoint({ expectedTotal: first.TotalResult, completedKeys: [...completedKeys] });
          console.info(`استورد ${completedKeys.size}/${first.TotalResult}؛ آخر تشريع: ${record.Name} (${articleCount} مادة).`);
        }
        if (pilot) {
          await saveCheckpoint({ expectedTotal: first.TotalResult, completedKeys: [...completedKeys] });
          console.info("اكتمل اختبار تشريع واحد؛ لم يُعلن اكتمال الاستيراد الشامل.");
          return;
        }
      }
      if (pageIndex % 25 === 0) console.info(`تقدّم البحث والاستيراد: ${seenCount}/${first.TotalResult} سجل.`);
    }

    if (seenCount !== first.TotalResult) {
      throw new Error(`عدد النتائج غير متطابق: المتوقع ${first.TotalResult}، المستلم ${seenCount}، الفريد ${seenKeys.size}.`);
    }

    await saveCheckpoint({ expectedTotal: first.TotalResult, completedKeys: [...completedKeys] });
    const importedCount = await withImporterAccess((tx) =>
      tx.legalSource.count({ where: { officialKey: { in: [...seenKeys] } } }),
    );
    const unprocessedKeys = [...seenKeys].filter((key) => !completedKeys.has(key));
    const noTextCount = await withImporterAccess((tx) =>
      tx.legalSource.count({ where: { officialKey: { in: [...seenKeys] }, articles: { none: {} } } }),
    );
    const skippedCount = noTextCount;
    if (unprocessedKeys.length || importedCount !== seenKeys.size) {
      throw new Error(`لم يكتمل التحقق: البوابة ${first.TotalResult}، نقاط الاستيراد ${completedKeys.size}، المخزن ${importedCount}.`);
    }
    const { unlink } = await import("node:fs/promises");
    await unlink(CHECKPOINT_PATH);
    console.info(`اكتمل الاستيراد والتحقق من ${importedCount} تشريعاً رسمياً؛ متخطي لبعدم قابلية القراءة من المصدر: ${skippedCount}.`);
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
