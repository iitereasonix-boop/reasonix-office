import { Role } from "@prisma/client";
import { route } from "@/lib/api";
import { withDatabaseAccess } from "@/lib/auth";

export const GET = route([Role.SENIOR_LAWYER], async (user, request) => {
  const params = request.nextUrl.searchParams;
  return withDatabaseAccess(user, async (tx) => {
    if (params.get("view") === "agents") {
      const runs = await tx.agentRun.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { name: true } } } });
      return { runs };
    }
    const entries = await tx.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: { name: true } }, legalCase: { select: { caseNumber: true } } } });
    return { entries };
  });
});
