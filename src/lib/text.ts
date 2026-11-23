/** Folds Arabic spelling variants so a search matches however the text was typed or extracted. */
export function normalizeArabic(value: string) {
  return value
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set(["في", "من", "علي", "الي", "عن", "ما", "هل", "هو", "هي", "ان", "او", "و", "لي", "شو", "مع", "هذا", "هذه"]);

export function searchTerms(query: string) {
  return [...new Set(normalizeArabic(query).split(/[^\p{L}\p{N}/-]+/u))]
    .map((term) => term.replace(/^(وال|بال|لل|فال|ال)(?=.{3,})/, ""))
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term))
    .slice(0, 12);
}

export function scoreText(searchText: string, terms: string[]) {
  return terms.reduce((score, term) => score + (searchText.includes(term) ? 1 : 0), 0);
}

/** Cuts a window around the first matching line; offsets are taken on the original text. */
export function snippet(text: string, terms: string[], length = 420) {
  const lines = text.split("\n");
  const hit = lines.findIndex((line) => terms.some((term) => normalizeArabic(line).includes(term)));
  const start = Math.max(hit, 0);
  const excerpt = lines.slice(Math.max(start - 1, 0), start + 5).join("\n").trim();
  return excerpt.length > length ? `${excerpt.slice(0, length)}…` : excerpt;
}

/** WhatsApp needs the country code, so a local Jordanian number is converted: 079... becomes 96279... */
export function whatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^00/, "");
  if (digits.startsWith("0")) return `962${digits.slice(1)}`;
  return digits.length === 9 && digits.startsWith("7") ? `962${digits}` : digits;
}
