import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { z } from "zod";
import { clearRateLimit, clientIp, rateLimit } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "أدخل البريد وكلمة المرور." }, { status: 400 });

  const email = parsed.data.email.toLowerCase();
  const limitKey = `login:${clientIp(request)}:${email}`;
  if (!rateLimit(limitKey, 8, 15 * 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة. انتظر 15 دقيقة ثم أعد المحاولة." }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user?.active && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  if (!valid || !user) return NextResponse.json({ error: "بيانات الدخول غير صحيحة." }, { status: 401 });
  if (user.role === Role.CLIENT) {
    return NextResponse.json({ error: "بوابة العملاء غير متاحة في هذه المرحلة." }, { status: 403 });
  }

  clearRateLimit(limitKey); // Only failed attempts count against a person.
  await createSession(user);
  return NextResponse.json({ ok: true, name: user.name, role: user.role });
}
