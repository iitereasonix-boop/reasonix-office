import { NextRequest, NextResponse } from "next/server";
import { ConsultationStatus } from "@prisma/client";
import { z } from "zod";
import { clientIp, officeRoles, parseBody, rateLimit, requireId, route } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const publicSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(7).max(32),
  email: z.union([z.string().trim().email(), z.literal("")]).optional(),
  topic: z.string().trim().min(2).max(120),
  message: z.string().trim().min(5).max(2000),
  preferredAt: z.union([z.string().datetime(), z.literal("")]).optional(),
  website: z.string().max(0).optional(), // honeypot: hidden from people, filled by bots
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`consultation:${clientIp(request)}`, 5, 3_600_000)) {
    return NextResponse.json({ error: "استلمنا طلبات كثيرة من هذا الجهاز. حاول لاحقاً أو تواصل معنا هاتفياً." }, { status: 429 });
  }
  const parsed = publicSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "راجع البيانات المدخلة: الاسم والهاتف وموضوع الاستشارة." }, { status: 400 });
  const { email, preferredAt, ...data } = parsed.data;
  delete data.website;
  // createMany issues no RETURNING, so this anonymous insert needs no read access.
  await prisma.consultationRequest.createMany({
    data: [{ ...data, email: email || null, preferredAt: preferredAt ? new Date(preferredAt) : null }],
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export const GET = route(officeRoles, async (user) => {
  const requests = await withDatabaseAccess(user, (tx) =>
    tx.consultationRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  );
  return { requests };
});

const updateSchema = z.object({ status: z.nativeEnum(ConsultationStatus) });

/** CONVERTED also opens a client record, so a request never has to be retyped. */
export const PATCH = route(officeRoles, async (user, request) => {
  const id = requireId(request);
  const { status } = await parseBody(request, updateSchema, "حالة غير صالحة.");
  const clientId = await withDatabaseAccess(user, async (tx) => {
    const consultation = await tx.consultationRequest.update({ where: { id }, data: { status } });
    if (status !== "CONVERTED") return null;
    const client = await tx.client.create({
      data: { name: consultation.name, phone: consultation.phone, notes: `طلب استشارة: ${consultation.topic}\n${consultation.message}` },
    });
    return client.id;
  });
  await logAudit(user, "CONSULTATION_UPDATED", "ConsultationRequest", id, { status });
  return { ok: true, clientId };
});
