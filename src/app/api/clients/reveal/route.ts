import { HttpError, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { unseal } from "@/lib/crypto";

/** The only route that returns a full national ID, and every call is audited. */
export const GET = route(staffRoles, async (user, request) => {
  const id = requireId(request);
  if (!user.canViewNationalId) throw new HttpError("ليست لديك صلاحية عرض الرقم الوطني.", 403);
  const client = await withDatabaseAccess(user, (tx) => tx.client.findFirst({ where: { id, deletedAt: null }, select: { nationalId: true } }));
  if (!client) throw new HttpError("العميل غير موجود.", 404);
  await logAudit(user, "NATIONAL_ID_VIEWED", "Client", id);
  return { nationalId: unseal(client.nationalId) };
});
