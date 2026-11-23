import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import { CLAUDE_MODEL, claudeClient, compatibleProvider } from "@/lib/assistant/client";
import { chatCompletion } from "@/lib/assistant/providers";
import { normalizeArabic } from "@/lib/text";

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const DOCUMENT_ACCEPT = Object.keys(ALLOWED_DOCUMENT_TYPES).join(",");
const WORD_SECTION_CHARS = 3000;

export type ExtractedPage = { page: number; text: string; searchText: string };

const toPage = (text: string, index: number): ExtractedPage => ({
  page: index + 1,
  text: text.trim(),
  searchText: normalizeArabic(text),
});

const scannedPages = z.object({ pages: z.array(z.string()) });

/** Scanned court papers and photos have no text layer, so Claude reads them page by page. */
async function transcribe(content: Buffer, mimeType: string) {
  const compatible = await compatibleProvider();
  if (compatible) {
    // Scanned PDFs need Claude; other providers read photos at most.
    if (!compatible.provider.vision || mimeType === "application/pdf") throw new Error("This AI provider cannot read scanned files");
    const { text } = await chatCompletion(compatible, [{
      role: "user",
      content: [
        { type: "text", text: "انسخ نص هذا المستند القانوني كما هو دون تلخيص أو تصحيح أو إضافة. أعد النص فقط." },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${content.toString("base64")}` } },
      ],
    }]);
    return [text];
  }
  const client = await claudeClient();
  // Long documents need streaming: the SDK refuses a non-streaming request this large.
  const message = await client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 32000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["pages"],
          properties: { pages: { type: "array", items: { type: "string" } } },
        },
      },
    },
    messages: [{
      role: "user",
      content: [
        mimeType === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: content.toString("base64") } }
          : { type: "image", source: { type: "base64", media_type: mimeType as "image/png", data: content.toString("base64") } },
        { type: "text", text: "انسخ نص هذا المستند القانوني كما هو دون تلخيص أو تصحيح أو إضافة. أعد عنصراً واحداً في pages لكل صفحة، بترتيب الصفحات، وعنصراً فارغاً للصفحة الخالية." },
      ],
    }],
  }).finalMessage();
  if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") throw new Error(`Transcription stopped: ${message.stop_reason}`);
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  return scannedPages.parse(JSON.parse(text)).pages;
}

const PRESENTATION_FORMS = /[ﭐ-﷿ﹰ-﻿]/g;

/** Many PDFs store Arabic as shaped glyphs in visual order, which search cannot match. */
export function hasVisualArabic(pages: string[]) {
  const text = pages.join("");
  const shaped = text.match(PRESENTATION_FORMS)?.length ?? 0;
  const arabic = text.match(/[؀-ۿ]/g)?.length ?? 0;
  return shaped > (shaped + arabic) * 0.1;
}

/** Best-effort repair per line: undo the visual order, keep Latin and digit runs readable. */
export function repairVisualArabic(page: string) {
  return page
    .split("\n")
    .map((line) => [...line].reverse().join("").replace(/[A-Za-z0-9٠-٩.,:/-]{2,}/g, (run) => [...run].reverse().join("")).normalize("NFKC"))
    .join("\n");
}

/** allowAi is false until the office opts in, so nothing leaves the server by default. */
export async function extractPages(content: Buffer, mimeType: string, allowAi = false): Promise<ExtractedPage[]> {
  if (mimeType === "text/plain") {
    // A form feed separates pages, as in text exported from court systems.
    return content.toString("utf8").split("\f").map(toPage).filter((page) => page.text);
  }
  if (mimeType.endsWith("wordprocessingml.document")) {
    // Word has no fixed pages, so sections stand in for them and citations stay stable.
    const { value } = await mammoth.extractRawText({ buffer: content });
    const sections: string[] = [];
    let current = "";
    for (const paragraph of value.split(/\n+/)) {
      if (current.length + paragraph.length > WORD_SECTION_CHARS && current) {
        sections.push(current);
        current = "";
      }
      current += `${paragraph}\n`;
    }
    if (current.trim()) sections.push(current);
    return sections.map(toPage);
  }
  if (mimeType.startsWith("image/")) return allowAi ? (await transcribe(content, mimeType)).map(toPage) : [];
  const pdf = await getDocumentProxy(new Uint8Array(content));
  const { text } = await extractText(pdf, { mergePages: false });
  const hasTextLayer = text.some((page) => page.trim().length > 20);
  const isVisual = hasTextLayer && hasVisualArabic(text);
  if (hasTextLayer && !isVisual) return text.map(toPage);
  if (allowAi) {
    try {
      return (await transcribe(content, mimeType)).map(toPage);
    } catch (error) {
      if (!isVisual) throw error;
      console.error(error);
    }
  }
  return isVisual ? text.map(repairVisualArabic).map(toPage) : [];
}
