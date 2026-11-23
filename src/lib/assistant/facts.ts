const toLatin = (value: string) => value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

/** Tools show some dates as DD/MM/YYYY, so both spellings of a known date count as known. */
function normalizeEvidence(evidence: string[]) {
  const joined = toLatin(evidence.join(" ")).replace(/\\\//g, "/");
  const swapped = [...joined.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map(([, day, month, year]) => `${year}/${month}/${day}`);
  return `${joined} ${swapped.join(" ")}`;
}

/** Case numbers, dates and article numbers are the facts most costly to invent, so each is checked against tool output. */
export function unverifiedFacts(answer: string, evidence: string[]) {
  const known = normalizeEvidence(evidence);
  const text = toLatin(answer);
  const numbers = text.match(/\b\d{4}\/\d{1,2}\/\d{1,2}\b|\b\d{4}\/\d{1,4}\b/g) ?? [];
  const articles = [...text.matchAll(/(?:ال)?(?:مادة|مواد)\s*(?:رقم\s*)?[(\[]?\s*(\d+)/g)].map((match) => match[1]);
  return [...new Set([...numbers, ...articles])].filter((fact) => !known.includes(fact));
}


