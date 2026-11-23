import { HttpError, requireId, route, staffRoles } from "@/lib/api";
import { withDatabaseAccess } from "@/lib/auth";

export const GET = route(staffRoles, async (user, request) => {
  const id = request.nextUrl.searchParams.get("id");
  return withDatabaseAccess(user, async (tx) => {
    if (!id) {
      const conversations = await tx.conversation.findMany({
        orderBy: { updatedAt: "desc" },
        take: 30,
        select: { id: true, title: true, updatedAt: true, legalCase: { select: { id: true, caseNumber: true } } },
      });
      return { conversations };
    }
    const conversation = await tx.conversation.findFirst({
      where: { id },
      include: { legalCase: { select: { id: true, caseNumber: true } }, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) throw new HttpError("المحادثة غير موجودة.", 404);
    return { conversation };
  });
});

export const DELETE = route(staffRoles, async (user, request) => {
  const id = requireId(request);
  await withDatabaseAccess(user, (tx) => tx.conversation.deleteMany({ where: { id } }));
  return { ok: true };
});
