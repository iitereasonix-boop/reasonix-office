import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, officeRoles, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { maskId, seal, unseal } from "@/lib/crypto";

const fields = {
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(7).max(32),
  nationalId: z.string().trim().max(32).optional(),
  address: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
};
const createSchema = z.object(fields);
const updateSchema = z.object(fields).partial();

export const GET = route(staffRoles, async (user) => {
  const clients = await withDatabaseAccess(user, (tx) =>
    tx.client.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { cases: { where: { deletedAt: null } } } } },
      orderBy: { updatedAt: "desc" },
    }),
  );
  return {
    clients: clients.map(({ nationalId, notes, ...client }) => ({
      ...client,
      // Masked even for permitted users; the full number is a separate, audited request.
      nationalId: user.canViewNationalId ? maskId(unseal(nationalId)) : null,
      notes: user.canViewPrivateNotes ? notes : null,
    })),
  };
});

export const POST = route(officeRoles, async (user, request) => {
  const data = await parseBody(request, createSchema, "راجع بيانات العميل المدخلة.");
  const client = await withDatabaseAccess(user, (tx) => tx.client.create({ data: { ...data, nationalId: user.canViewNationalId ? seal(data.nationalId) : null } }));
  await logAudit(user, "CLIENT_CREATED", "Client", client.id);
  return NextResponse.json({ client: { id: client.id, name: client.name } }, { status: 201 });
});

export const PATCH = route(officeRoles, async (user, request) => {
  const id = requireId(request);
  const data = await parseBody(request, updateSchema, "راجع بيانات العميل المدخلة.");
  // Protected fields stay out of the update for anyone who cannot see them.
  if (!user.canViewNationalId) delete data.nationalId;
  if (!user.canViewPrivateNotes) delete data.notes;
  if (data.nationalId) data.nationalId = seal(data.nationalId);
  const client = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.client.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    return existing ? tx.client.update({ where: { id }, data, select: { id: true, name: true } }) : null;
  });
  if (!client) throw new HttpError("العميل غير موجود.", 404);
  await logAudit(user, "CLIENT_UPDATED", "Client", id);
  return { client };
});

export const DELETE = route(officeRoles, async (user, request) => {
  const id = requireId(request);
  await withDatabaseAccess(user, async (tx) => {
    const open = await tx.legalCase.count({ where: { clientId: id, deletedAt: null } });
    if (open) throw new HttpError("لا يمكن حذف عميل لديه قضايا مسجلة.", 409);
    await tx.client.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  await logAudit(user, "CLIENT_DELETED", "Client", id);
  return { ok: true };
});
