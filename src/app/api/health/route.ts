import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertNoRlsBypass } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Railway's healthcheck. Fails when the database is down or RLS would be skipped. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const rlsEnforced = await assertNoRlsBypass();
    return NextResponse.json({ ok: rlsEnforced, database: true, rlsEnforced }, { status: rlsEnforced ? 200 : 503 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false, database: false }, { status: 503 });
  }
}
