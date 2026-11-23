import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withDatabaseAccess, type SafeUser } from "@/lib/auth";
import { isAssistantConfigured } from "@/lib/assistant/client";

export const officeSettings = (tx: Prisma.TransactionClient) => tx.officeSetting.findUniqueOrThrow({ where: { id: 1 } });

/** Case content leaves the server only with a key and the senior lawyer's explicit opt-in. */
export async function aiAllowed(user: SafeUser) {
  if (!(await isAssistantConfigured())) return false;
  return (await withDatabaseAccess(user, officeSettings)).aiEnabled;
}

export async function assertNoRlsBypass() {
  const [role] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  return !role.rolsuper && !role.rolbypassrls;
}
