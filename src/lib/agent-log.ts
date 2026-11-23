import type { Prisma } from "@prisma/client";
import { CLAUDE_MODEL } from "@/lib/assistant/client";
import { withDatabaseAccess, type SafeUser } from "@/lib/auth";

/** Append-only record of every model call: input, output and who asked. */
export async function logAgentRun(user: SafeUser, run: { agent: string; caseId?: string; input: unknown; output?: unknown; status: string }) {
  await withDatabaseAccess(user, (tx) =>
    tx.agentRun.create({
      data: {
        agent: run.agent,
        userId: user.id,
        caseId: run.caseId,
        input: run.input as Prisma.InputJsonValue,
        output: (run.output ?? undefined) as Prisma.InputJsonValue | undefined,
        status: run.status,
        model: CLAUDE_MODEL,
      },
    }),
  );
}
