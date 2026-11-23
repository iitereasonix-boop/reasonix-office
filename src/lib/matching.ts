import { normalizeArabic } from "@/lib/text";

export const CONFIDENT_MATCH = 0.92;
const POSSIBLE_MATCH = 0.72;
const CLEAR_LEAD = 0.15;
const TITLES = new Set(["السيد", "السيده", "الاستاذ", "الاستاذه", "الدكتور", "المحامي", "شركه", "مؤسسه", "ذم", "م"]);

const tokens = (name: string) =>
  normalizeArabic(name).replace(/[^\p{L}\p{N} ]/gu, " ").split(" ").filter((part) => part && !TITLES.has(part));

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

const tokenScore = (a: string, b: string) => 1 - editDistance(a, b) / Math.max(a.length, b.length);

/** Word-by-word similarity, so a reordered name still matches and extra words lower the score. */
export function nameSimilarity(a: string, b: string) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.length || !right.length) return 0;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  const available = [...long];
  let total = 0;
  for (const word of short) {
    let bestIndex = -1;
    let best = 0;
    available.forEach((candidate, index) => {
      const score = tokenScore(word, candidate);
      if (score > best) { best = score; bestIndex = index; }
    });
    total += best;
    if (bestIndex >= 0) available.splice(bestIndex, 1);
  }
  return (total / short.length) * (0.75 + 0.25 * (short.length / long.length));
}

export type MatchCandidate = { id: string; name: string };

/**
 * Suggests a client only when one candidate is clearly ahead. A tie between two similar
 * names is exactly the case a person must decide, so it is never resolved here.
 */
export function matchClient(name: string | null | undefined, clients: MatchCandidate[]) {
  if (!name) return { client: null, score: 0, confident: false, reason: "لم يُستخرج اسم الموكّل." };
  const ranked = clients.map((client) => ({ client, score: nameSimilarity(name, client.name) })).sort((a, b) => b.score - a.score);
  const [first, second] = ranked;
  if (!first || first.score < POSSIBLE_MATCH) return { client: null, score: first?.score ?? 0, confident: false, reason: "لا يوجد عميل مطابق." };
  if (first.score < CONFIDENT_MATCH) return { client: first.client, score: first.score, confident: false, reason: "تطابق جزئي يحتاج مراجعة." };
  if (second && first.score - second.score < CLEAR_LEAD) return { client: first.client, score: first.score, confident: false, reason: "يوجد أكثر من عميل بأسماء متقاربة." };
  return { client: first.client, score: first.score, confident: true, reason: "تطابق عالي الثقة." };
}

export type ConflictHit = { kind: "client" | "opposing"; name: string; matched: string; caseNumber: string | null; href: string };

/** People on the other side of an earlier matter are the conflict that matters most. */
export function findConflicts(
  names: { name: string; role: "client" | "opposing" }[],
  clients: { id: string; name: string }[],
  cases: { id: string; caseNumber: string; clientName: string; opposingParties: string[] }[],
) {
  const hits: ConflictHit[] = [];
  const close = (a: string, b: string) => nameSimilarity(a, b) >= CONFIDENT_MATCH;
  for (const { name, role } of names) {
    if (role === "opposing") {
      for (const client of clients) if (close(name, client.name)) hits.push({ kind: "client", name, matched: client.name, caseNumber: null, href: `/app/clients?q=${encodeURIComponent(client.name)}` });
      for (const item of cases) if (close(name, item.clientName)) hits.push({ kind: "client", name, matched: item.clientName, caseNumber: item.caseNumber, href: `/app/cases/${item.id}` });
    } else {
      for (const item of cases) {
        const party = item.opposingParties.find((other) => close(name, other));
        if (party) hits.push({ kind: "opposing", name, matched: party, caseNumber: item.caseNumber, href: `/app/cases/${item.id}` });
      }
    }
  }
  return hits;
}
