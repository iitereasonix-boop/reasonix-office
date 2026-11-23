import { createHash, randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/api";
import { createSession, systemUser, withDatabaseAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { digitsOnly, isWhatsappConfigured, sendWhatsapp } from "@/lib/whatsapp";

const requestSchema = z.object({ phone: z.string().trim().min(7).max(32) });
const verifySchema = requestSchema.extend({ code: z.string().trim().length(6) });
const TEN_MINUTES = 10 * 60_000;
const MAX_ATTEMPTS = 5;

const hash = (phone: string, code: string) => createHash("sha256").update(`${digitsOnly(phone).slice(-9)}:${code}`).digest("hex");

async function findClient(phone: string) {
  const user = await systemUser();
  if (!user) return null;
  return withDatabaseAccess(user, async (tx) => {
    const clients = await tx.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true, phone: true, userId: true } });
    return clients.find((client) => digitsOnly(client.phone).slice(-9) === digitsOnly(phone).slice(-9)) ?? null;
  });
}

const SAME_ANSWER = { ok: true, message: "إن كان الرقم مسجلاً لدى المكتب سيصلك رمز عبر واتساب." };

/** Answers the same either way, so the form cannot be used to discover who is a client. */
export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "أدخل رقم الهاتف." }, { status: 400 });
  if (!rateLimit(`otp:${clientIp(request)}`, 5, 15 * 60_000) || !rateLimit(`otp:${digitsOnly(parsed.data.phone).slice(-9)}`, 3, 15 * 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة. انتظر 15 دقيقة." }, { status: 429 });
  }
  const client = await findClient(parsed.data.phone);
  const system = await systemUser();
  if (!client || !system) return NextResponse.json(SAME_ANSWER);
  const code = String(randomInt(100000, 1000000));
  await withDatabaseAccess(system, (tx) => tx.clientOtp.create({ data: { phone: digitsOnly(client.phone).slice(-9), codeHash: hash(client.phone, code), expiresAt: new Date(Date.now() + TEN_MINUTES) } }));
  if (isWhatsappConfigured()) {
    await sendWhatsapp(client.phone, { body: `رمز الدخول إلى بوابة مكتب ريزونكس: ${code}\nصالح لعشر دقائق.` }).catch((error: unknown) => console.error("OTP send failed", error));
  } else if (process.env.NODE_ENV !== "production") {
    console.info(`[dev] portal code for ${client.phone}: ${code}`);
  } else {
    return NextResponse.json({ error: "بوابة العملاء تحتاج ربط واتساب." }, { status: 503 });
  }
  return NextResponse.json(SAME_ANSWER);
}

export async function PUT(request: NextRequest) {
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "أدخل الرمز المكون من 6 أرقام." }, { status: 400 });
  const invalid = NextResponse.json({ error: "الرمز غير صحيح أو منتهي." }, { status: 401 });
  const system = await systemUser();
  const client = await findClient(parsed.data.phone);
  if (!client || !system) return invalid;
  const phone = digitsOnly(client.phone).slice(-9);
  const account = await withDatabaseAccess(system, async (tx) => {
    const otp = await tx.clientOtp.findFirst({ where: { phone, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (!otp || otp.attempts >= MAX_ATTEMPTS) return null;
    if (otp.codeHash !== hash(client.phone, parsed.data.code)) {
      await tx.clientOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return null;
    }
    await tx.clientOtp.deleteMany({ where: { phone } });
    return true;
  });
  if (!account) return invalid;
  let user = client.userId ? await prisma.user.findUnique({ where: { id: client.userId } }) : null;
  if (!user) {
    // Clients never sign in with a password, so this one is random and unused.
    user = await prisma.user.create({
      data: { name: client.name, email: `client-${client.id}@portal.reasonix.local`, role: Role.CLIENT, passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12) },
    });
    const created = user;
    await withDatabaseAccess(system, (tx) => tx.client.update({ where: { id: client.id }, data: { userId: created.id } }));
  }
  if (!user.active) return invalid;
  await createSession(user);
  return NextResponse.json({ ok: true });
}
