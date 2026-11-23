import { normalizeArabic } from "@/lib/text";

const toLatinDigits = (value: string) => value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

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
