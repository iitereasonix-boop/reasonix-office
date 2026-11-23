import { NextRequest, NextResponse } from "next/server";
import { logAudit, systemUser, withDatabaseAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { digitsOnly, isStartRequest, isStopRequest, validSignature } from "@/lib/whatsapp";

type Inbound = { id: string; from: string; text?: { body?: string }; type: string };
type Status = { id: string; status: string; errors?: { title?: string }[] };

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === expected) {
    return new Response(params.get("hub.challenge") ?? "");
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

/** Phones are stored in free form, so matching compares the last nine digits. */
const samePhone = (a: string, b: string) => digitsOnly(a).slice(-9) === digitsOnly(b).slice(-9);

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const user = await systemUser();
  if (!user) return NextResponse.json({ ok: true });
  const payload = JSON.parse(raw) as { entry?: { changes?: { value?: { messages?: Inbound[]; statuses?: Status[] } }[] }[] };
  const values = payload.entry?.flatMap((entry) => entry.changes ?? []).map((change) => change.value) ?? [];

  for (const value of values) {
    for (const status of value?.statuses ?? []) {
      await withDatabaseAccess(user, (tx) => tx.message.updateMany({
        where: { waMessageId: status.id },
        data: { deliveryStatus: status.status, failure: status.errors?.[0]?.title ?? undefined },
      }));
    }
    for (const inbound of value?.messages ?? []) {
      const body = inbound.text?.body ?? `[${inbound.type}]`;
      const message = await withDatabaseAccess(user, async (tx) => {
        if (await tx.message.findUnique({ where: { waMessageId: inbound.id }, select: { id: true } })) return null;
        const clients = await tx.client.findMany({ where: { deletedAt: null }, select: { id: true, phone: true } });
        const client = clients.find((item) => samePhone(item.phone, inbound.from));
        // With one live case the message belongs there; with several, a person decides.
        const cases = client ? await tx.legalCase.findMany({ where: { clientId: client.id, deletedAt: null, status: { not: "CLOSED" } }, select: { id: true }, take: 2 }) : [];
        if (client && isStopRequest(body)) await tx.client.update({ where: { id: client.id }, data: { whatsappOptOutAt: new Date() } });
        if (client && isStartRequest(body)) await tx.client.update({ where: { id: client.id }, data: { whatsappOptOutAt: null } });
        return tx.message.create({
          data: {
            clientId: client?.id, caseId: cases.length === 1 ? cases[0].id : undefined, body, direction: "INBOUND", status: "SENT",
            fromPhone: inbound.from, waMessageId: inbound.id, sentAt: new Date(),
          },
        });
      });
      if (message) await logAudit(user, "MESSAGE_RECEIVED", "Message", message.id, { matched: Boolean(message.clientId) }, message.caseId ?? undefined);
    }
  }
  await prisma.$disconnect().catch(() => undefined);
  return NextResponse.json({ ok: true });
}
