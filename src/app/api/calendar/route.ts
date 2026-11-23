import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, withDatabaseAccess, type SafeUser } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { buildCalendar } from "@/lib/ics";
import { prisma } from "@/lib/prisma";

async function feed(user: SafeUser) {
  const hearings = await withDatabaseAccess(user, (tx) =>
    tx.hearing.findMany({
      where: { deletedAt: null, startsAt: { gte: addDays(new Date(), -30) }, legalCase: { deletedAt: null } },
      include: { legalCase: { select: { caseNumber: true, courtCity: true } } },
      orderBy: { startsAt: "asc" },
      take: 500,
    }),
  );
  // Client names stay out: a calendar feed is synced to outside services.
  const body = buildCalendar(hearings.map((hearing) => ({
    id: hearing.id,
    start: hearing.startsAt,
    title: `جلسة القضية ${hearing.legalCase.caseNumber}`,
    location: [hearing.courtroom, hearing.legalCase.courtCity].filter(Boolean).join(" - "),
    description: hearing.purpose,
  })));
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "attachment; filename=reasonix-hearings.ics", "Cache-Control": "private, no-store" } });
}

/** Signed-in download, or a private feed token for Google Calendar's "add by URL". */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (token) {
    const owner = await prisma.user.findUnique({
      where: { calendarToken: token },
      select: { id: true, name: true, email: true, role: true, canViewPrivateNotes: true, canViewNationalId: true, active: true },
    });
    if (!owner?.active || owner.role === "CLIENT") return NextResponse.json({ error: "رابط غير صالح." }, { status: 404 });
    return feed(owner);
  }
  const user = await getCurrentUser();
  if (!user || user.role === "CLIENT") return NextResponse.json({ error: "يلزم تسجيل الدخول." }, { status: 401 });
  return feed(user);
}

/** Issuing a new token invalidates the old link. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role === "CLIENT") return NextResponse.json({ error: "يلزم تسجيل الدخول." }, { status: 401 });
  const calendarToken = randomBytes(24).toString("base64url");
  await prisma.user.update({ where: { id: user.id }, data: { calendarToken } });
  return NextResponse.json({ token: calendarToken });
}
