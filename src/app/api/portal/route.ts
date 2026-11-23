import { Role } from "@prisma/client";
import { route } from "@/lib/api";
import { withDatabaseAccess } from "@/lib/auth";

/** Status and hearings only: no notes, fees, documents or hearing decisions. */
export const GET = route([Role.CLIENT], async (user) => {
  const cases = await withDatabaseAccess(user, (tx) =>
    tx.legalCase.findMany({
      where: { deletedAt: null, clientId: user.clientId ?? "" },
      select: {
        id: true, caseNumber: true, title: true, status: true, type: true, court: true, courtCity: true,
        hearings: { where: { deletedAt: null }, orderBy: { startsAt: "desc" }, select: { id: true, startsAt: true, purpose: true, courtroom: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  );
  return { name: user.name, cases };
});
