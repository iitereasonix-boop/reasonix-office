import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Role, type Prisma, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "reasonix_session";
const SESSION_DAYS = 7;

export type SafeUser = Pick<
  User,
  "id" | "name" | "email" | "role" | "canViewPrivateNotes" | "canViewNationalId"
> & { clientId?: string | null };

const safeUser = (user: User): SafeUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  canViewPrivateNotes: user.canViewPrivateNotes,
  canViewNationalId: user.canViewNationalId,
});

export async function createSession(user: User) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { tokenHash: createHash("sha256").update(token).digest("hex"), userId: user.id, expiresAt },
  });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<SafeUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active) return null;
  if (session.user.role !== Role.CLIENT) return safeUser(session.user);
  const client = await withDatabaseAccess(safeUser(session.user), (tx) =>
    tx.client.findFirst({ where: { userId: session.user.id, deletedAt: null }, select: { id: true } }),
  );
  return client ? { ...safeUser(session.user), clientId: client.id } : null;
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({
      where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    });
  }
  cookieStore.delete(COOKIE_NAME);
}

export async function requireUser(allowed?: Role[]) {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "يلزم تسجيل الدخول." }, { status: 401 }) };
  }
  if (allowed && !allowed.includes(user.role)) {
    return { user: null, response: NextResponse.json({ error: "ليست لديك صلاحية لهذا الإجراء." }, { status: 403 }) };
  }
  return { user, response: null };
}

export function withDatabaseAccess<T>(
  user: SafeUser,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${user.id}, true), set_config('app.user_role', ${user.role}, true), set_config('app.private_notes', ${String(user.canViewPrivateNotes)}, true), set_config('app.national_id', ${String(user.canViewNationalId)}, true), set_config('app.client_id', ${user.clientId ?? ""}, true)`;
    return callback(tx);
  });
}

export async function logAudit(
  user: SafeUser,
  action: string,
  entityType: string,
  entityId: string,
  details?: object,
  caseId?: string,
) {
  await withDatabaseAccess(user, (tx) =>
    tx.auditLog.create({
      data: { userId: user.id, action, entityType, entityId, details, caseId },
    }),
  );
}

/** Background work has no session, so it acts as the first active senior lawyer. */
export function systemUser(): Promise<SafeUser | null> {
  return prisma.user.findFirst({
    where: { role: Role.SENIOR_LAWYER, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, canViewPrivateNotes: true, canViewNationalId: true },
  });
}

export const seniorOnly = [Role.SENIOR_LAWYER];
