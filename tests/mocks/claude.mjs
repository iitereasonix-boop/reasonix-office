// Stand-in for POST /v1/messages that speaks the real SSE event shape and logs what the app sent.
import { appendFileSync, writeFileSync } from "node:fs";
import http from "node:http";

const log = process.argv[2];
writeFileSync(log, "");

const frames = (content, stop) => {
  const out = [["message_start", { type: "message_start", message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model: "mock", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }]];
  content.forEach((block, index) => {
    if (block.type === "text") {
      out.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      for (const chunk of block.text.match(/.{1,25}/gs)) out.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: chunk } }]);
    } else {
      out.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } }]);
      out.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }]);
    }
    out.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  out.push(["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }]);
  out.push(["message_stop", { type: "message_stop" }]);
  return out;
};

const tool = (name, input) => ({ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, name, input });

function respond(body) {
  const messages = body.messages;
  const firstUser = [...messages].reverse().find((m) => m.role === "user" && typeof m.content === "string")?.content ?? "";
  const results = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");
  const last = results.at(-1)?.content;
  const wantsDraft = firstUser.includes("مسودة");
  if (firstUser.includes("اختراع مادة")) {
    if (!results.length) return [[tool("get_case_file", { case_ref: "2026/124" })], "tool_use"];
    if (results.length === 1) return [[tool("save_legal_draft", { case_ref: "2026/124", title: "مسودة مختلقة", kind: "MEMO", body: "استناداً إلى المادة (97) من قانون الأصول نطلب التأجيل [S1] وهذا نص كافٍ للطول." })], "tool_use"];
    return [[{ type: "text", text: "تعذر حفظ المسودة: " + String(last).slice(0, 120) }], "end_turn"];
  }
  if (firstUser.includes("المكتبة")) {
    if (!results.length) return [[tool("search_legal_texts", { query: "اختبار" })], "tool_use"];
    const found = JSON.parse(last);
    return [[{ type: "text", text: found.length ? `المادة ${found[0].article} [${found[0].source}]` : "النص غير موجود في مكتبة المكتب." }], "end_turn"];
  }
  if (firstUser.includes("private")) {
    if (!results.length) return [[tool("get_case_file", { case_ref: "2026/124" })], "tool_use"];
    return [[{ type: "text", text: `رد: ${String(last).slice(0, 200)}` }], "end_turn"];
  }
  if (results.length === 0) return [[tool("get_case_file", { case_ref: "2026/124" })], "tool_use"];
  if (results.length === 1) {
    const file = JSON.parse(last);
    const order = file.documents.find((d) => d.title === "قرار المحكمة");
    return [[tool("read_document_page", { document_id: order.document_id, page: 1 })], "tool_use"];
  }
  if (wantsDraft && results.length === 2) {
    return [[tool("save_legal_draft", { case_ref: "2026/124", title: "مذكرة طلب تأجيل الجلسة القادمة", kind: "MEMO", body: "حضرة رئيس وأعضاء محكمة بداية عمان الموقرين\nالموضوع: طلب تأجيل الجلسة [S1]\nبعد الاحترام، نلتمس تأجيل الجلسة المحددة بتاريخ 2026/11/18 لتمكين المدعي من استكمال كشف المبالغ." })], "tool_use"];
  }
  const sources = [...JSON.stringify(results).matchAll(/S\d+/g)].map((m) => m[0]);
  const page = [...new Set(sources)].at(-1);
  return [[{ type: "text", text: `آخر قرار في القضية رقم 2026/124 هو **تأجيل الجلسة** بتاريخ 2026/10/28 [${page}].\n- موعد الجلسة القادمة 2026/11/18 [S1]\n- مرجع مختلق يجب حذفه [S99]` }], "end_turn"];
}

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    if (req.url.startsWith("/compat/models")) {
      const bad = (req.headers.authorization ?? "").includes("bad");
      res.writeHead(bad ? 401 : 200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "text-embedding-3" }, { id: "gpt-5" }] }));
    }
    const body = JSON.parse(raw || "{}");
    if (req.url.startsWith("/compat/chat/completions")) {
      // Any OpenAI-style provider: one tool call, then an answer with a real and a fake citation.
      appendFileSync(log, JSON.stringify({ compat: true, model: body.model, tools: body.tools?.length }) + "\n");
      const results = body.messages.filter((m) => m.role === "tool");
      const asked = body.messages.findLast((m) => m.role === "user")?.content ?? "";
      let message;
      if (typeof asked === "string" && asked.includes("<untrusted_document_text>")) message = { role: "assistant", content: JSON.stringify({ client_name: { value: null, quote: null }, case_number: { value: "2026/901", quote: "القضية رقم 2026/901" }, court: { value: null, quote: null }, hearing_date: { value: null, quote: null } }) };
      else if (!results.length) message = { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_case_file", arguments: JSON.stringify({ case_ref: "2026/124" }) } }] };
      else {
        const source = JSON.parse(results[0].content).source;
        message = { role: "assistant", content: `ملف القضية 2026/124 [${source}] ومرجع مختلق [S99] وتاريخ مختلق 2031/1/1` };
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message }] }));
    }
    appendFileSync(log, `${JSON.stringify({ url: req.url, beta: req.headers["anthropic-beta"], model: body.model, fallbacks: body.fallbacks, thinking: body.thinking, tools: body.tools?.map((t) => t.name), eager: body.tools?.[0]?.eager_input_streaming, messages: body.messages })}\n`);
    if (body.output_config?.format) {
      // Structured output: OCR (streamed) and intake extraction.
      const prompt = JSON.stringify(body.messages);
      const paper = /<untrusted_document_text>([\s\S]*)<\/untrusted_document_text>/.exec(prompt)?.[1] ?? "";
      const field = (value, quote) => ({ value, quote });
      const extraction = paper.includes("مختلق")
        ? { client_name: field("سمير المختلق جداً", "الموكل: سمير المختلق جداً"), case_number: field("9999/1", "رقم 9999/1"), court: field(null, null), hearing_date: field(null, null) }
        : { client_name: field("أحمد محمد علي", "الموكل: أحمد محمد علي"), case_number: field("2026/777", "القضية رقم 2026/777"), court: field("محكمة استئناف عمان", "محكمة استئناف عمان"), hearing_date: field("2026-12-20 10:00", "الجلسة 2026-12-20 10:00") };
      const text = prompt.includes('"image"') ? JSON.stringify({ pages: ["نص مقروء من الصورة الممسوحة"] }) : JSON.stringify(extraction);
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const [event, data] of frames([{ type: "text", text }], "end_turn")) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_parse", type: "message", role: "assistant", model: "mock", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
      return;
    }
    const [content, stop] = respond(body);
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [event, data] of frames(content, stop)) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.end();
  });
}).listen(4599, () => console.log("mock ready"));
