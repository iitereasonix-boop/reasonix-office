import type { Prisma } from "@prisma/client";
import { findConflicts } from "@/lib/matching";

export async function conflictsFor(tx: Prisma.TransactionClient, names: { name: string; role: "client" | "opposing" }[], excludeClientId?: string) {
  const clients = await tx.client.findMany({ where: { deletedAt: null, id: { not: excludeClientId } }, select: { id: true, name: true } });
  const cases = await tx.legalCase.findMany({
    where: { deletedAt: null },
    select: { id: true, caseNumber: true, opposingParties: true, clientId: true, client: { select: { name: true } } },
  });
  return findConflicts(names, clients, cases.map((item) => ({ id: item.id, caseNumber: item.caseNumber, clientName: item.client.name, opposingParties: item.opposingParties })));
}
