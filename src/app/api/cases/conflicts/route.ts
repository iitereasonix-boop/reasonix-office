import { z } from "zod";
import { officeRoles, parseBody, route } from "@/lib/api";
import { withDatabaseAccess } from "@/lib/auth";
import { conflictsFor } from "@/lib/conflicts";

const schema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().trim().max(160).optional(),
  opposingParties: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
});

export const POST = route(officeRoles, async (user, request) => {
  const input = await parseBody(request, schema, "أدخل أسماء الأطراف.");
  const conflicts = await withDatabaseAccess(user, async (tx) => {
    const client = input.clientId ? await tx.client.findFirst({ where: { id: input.clientId }, select: { name: true } }) : null;
    const name = client?.name ?? input.clientName;
    return conflictsFor(tx, [
      ...(name ? [{ name, role: "client" as const }] : []),
      ...input.opposingParties.map((party) => ({ name: party, role: "opposing" as const })),
    ], input.clientId);
  });
  return { conflicts };
});
