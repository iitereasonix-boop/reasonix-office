import { ammanDayKey, displayDate } from "@/lib/dates";

export type RuleInput = {
  id: string; name: string; days: number; base: "DECISION" | "NOTIFICATION"; legalBasis: string;
  caseType?: string | null; court?: string | null; rollForward?: boolean; pauseInVacation?: boolean;
};
export type RuleSnapshot = { id: string; name: string; days: number; base: string; legalBasis: string; from: string; explanation: string };
/** A day range the office entered: an official holiday or the judicial vacation. Days are YYYY-MM-DD in Amman. */
export type Closure = { name: string; from: string; to: string; kind: "HOLIDAY" | "JUDICIAL_VACATION" };

const WEEKEND = new Set([5, 6]); // Friday and Saturday, Jordan's official weekend.
const MAX_STEPS = 10_000;

const nextDay = (key: string) => new Date(Date.parse(`${key}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const weekday = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay();
const closureOn = (closures: Closure[], key: string, kind?: Closure["kind"]) =>
  closures.find((closure) => closure.from <= key && key <= closure.to && (!kind || closure.kind === kind));
const show = (key: string) => key.replaceAll("-", "/");

/**
 * Applies a rule the lawyer wrote. No period lives in the code: the days, whether the count
 * pauses in the judicial vacation, and whether a last day on a holiday moves forward are all
 * the rule's own settings, and the holidays are the dates the office entered. The result is
 * only a proposal until a senior lawyer confirms it.
 */
export function proposeDeadline(rule: RuleInput, decidedAt: Date, notifiedAt?: Date | null, closures: Closure[] = []) {
  const start = rule.base === "NOTIFICATION" ? notifiedAt : decidedAt;
  if (!start) return null;
  const startKey = ammanDayKey(start);
  let key = startKey;
  let remaining = rule.days;
  let paused = 0;
  for (let step = 0; remaining > 0 && step < MAX_STEPS; step += 1) {
    key = nextDay(key);
    if (rule.pauseInVacation && closureOn(closures, key, "JUDICIAL_VACATION")) paused += 1;
    else remaining -= 1;
  }
  const counted = key;
  const reasons = new Set<string>();
  if (rule.rollForward) {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const closure = closureOn(closures, key);
      if (!closure && !WEEKEND.has(weekday(key))) break;
      reasons.add(closure ? closure.name : "عطلة نهاية الأسبوع");
      key = nextDay(key);
    }
  }
  const baseLabel = rule.base === "NOTIFICATION" ? "تاريخ التبليغ" : "تاريخ الحكم";
  const parts = [`${rule.days} يوماً من ${baseLabel} (${displayDate(start)})`];
  if (paused) parts.push(`مع وقف العدّ ${paused} يوماً خلال العطلة القضائية`);
  if (key !== counted) parts.push(`ونُقل آخر يوم من ${show(counted)} إلى ${show(key)} لأنه وافق ${[...reasons].join(" و")}`);
  const snapshot: RuleSnapshot = {
    id: rule.id,
    name: rule.name,
    days: rule.days,
    base: rule.base,
    legalBasis: rule.legalBasis,
    from: displayDate(start),
    explanation: `${parts.join("، ")}، حسب قاعدة «${rule.name}» — ${rule.legalBasis}. العطل كما أدخلها المكتب.`,
  };
  return { deadline: new Date(`${key}T09:00:00+03:00`), snapshot };
}

/** A rule with a blank type or court applies to all; a specific rule must match. */
export const ruleApplies = (rule: Pick<RuleInput, "caseType" | "court">, caseType: string, court: string) =>
  (!rule.caseType || rule.caseType === caseType) && (!rule.court || rule.court === court);

/** The case number as the Ministry of Justice writes it, for example 343/2021. */
export const mojCaseNumber = (number?: string | null, year?: number | null) => (number && year ? `${number}/${year}` : null);
