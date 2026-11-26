import { normalizeArabic } from "@/lib/text";

const toLatinDigits = (value: string) => value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

export function officialArticleText(value: string) {
  return value
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);?/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#([0-9]+);?/g, (_, code: string) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits a law on its "المادة N" headings; text with no headings stays one searchable block. */
export function splitArticles(text: string) {
  const heading = /(?:^|\n)\s*(?:ال)?مادة\s*(?:رقم\s*)?\(?\s*([0-9٠-٩]+)\s*\)?[^\n]*/g;
  const marks = [...text.matchAll(heading)];
  if (!marks.length) return [{ number: "النص", text: text.trim(), searchText: normalizeArabic(text) }];
  return marks.map((mark, index) => {
    const body = text.slice(mark.index, marks[index + 1]?.index ?? text.length).trim();
    return { number: toLatinDigits(mark[1]), text: body, searchText: normalizeArabic(body) };
  });
}
