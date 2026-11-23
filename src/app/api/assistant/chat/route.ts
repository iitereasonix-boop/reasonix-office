import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { HttpError, parseBody, rateLimit, route, staffRoles } from "@/lib/api";
import { describeAssistantError, runAssistant, toHistory, type AssistantEvent } from "@/lib/assistant/agent";
import { logAgentRun } from "@/lib/agent-log";
import { isAssistantConfigured } from "@/lib/assistant/client";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { aiAllowed } from "@/lib/settings";

export const dynamic = "force-dynamic";

const schema = z.object({
  question: z.string().trim().min(1).max(4000),
  conversationId: z.string().optional(),
  caseId: z.string().optional(),
});

export const POST = route(staffRoles, async (user, request) => {
  const input = await parseBody(request, schema, "اكتب سؤالك أولاً.");
  if (!rateLimit(`assistant:${user.id}`, 30, 60_000)) throw new HttpError("أرسلت أسئلة كثيرة خلال دقيقة. انتظر قليلاً.", 429);
  if (!(await isAssistantConfigured())) throw new HttpError("المساعد غير مفعّل بعد: أضف مفتاح الذكاء الاصطناعي من الإعدادات.", 503);

  if (!(await aiAllowed(user))) throw new HttpError("المساعد متوقف. يفعّله المحامي صاحب المكتب من الإعدادات بعد الموافقة على إرسال محتوى القضايا إلى مزود الذكاء الاصطناعي.", 503);

  const { conversation, history, openCase } = await withDatabaseAccess(user, async (tx) => {
    const openCase = input.caseId
      ? await tx.legalCase.findFirst({ where: { id: input.caseId, deletedAt: null }, select: { id: true, caseNumber: true, title: true } })
      : null;
    if (input.caseId && !openCase) throw new HttpError("القضية غير موجودة أو غير متاحة لك.", 404);
    const existing = input.conversationId
      ? await tx.conversation.findFirst({
          where: { id: input.conversationId },
          include: { messages: { orderBy: { createdAt: "desc" }, take: 20, select: { role: true, content: true } } },
        })
      : null;
    if (input.conversationId && !existing) throw new HttpError("المحادثة غير موجودة.", 404);
    const conversation = existing ?? await tx.conversation.create({
      data: { userId: user.id, caseId: openCase?.id, title: input.question.slice(0, 80) },
    });
    await tx.chatMessage.create({ data: { conversationId: conversation.id, role: "USER", content: input.question } });
    return { conversation, history: toHistory([...(existing?.messages ?? [])].reverse()), openCase };
  });
  await logAudit(user, "AI_QUESTION", "Conversation", conversation.id, { length: input.question.length }, openCase?.id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AssistantEvent | { type: "conversation"; id: string }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      emit({ type: "conversation", id: conversation.id });
      try {
        const result = await runAssistant({ user, history, question: input.question, openCase, emit, signal: request.signal });
        await withDatabaseAccess(user, async (tx) => {
          await tx.chatMessage.create({
            data: {
              conversationId: conversation.id,
              role: "ASSISTANT",
              content: result.text,
              sources: result.sources as unknown as Prisma.InputJsonValue,
              drafts: result.drafts as unknown as Prisma.InputJsonValue,
            },
          });
          await tx.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
        });
        await logAgentRun(user, { agent: "case-assistant", caseId: openCase?.id, input: { question: input.question }, output: result, status: "ok" });
        emit({ type: "done", ...result });
      } catch (error) {
        if (!request.signal.aborted) {
          console.error(error);
          await logAgentRun(user, { agent: "case-assistant", caseId: openCase?.id, input: { question: input.question }, status: "error" }).catch(() => undefined);
          emit({ type: "error", text: describeAssistantError(error) });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
});
