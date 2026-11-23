import { NextResponse } from "next/server";
import { systemUser, withDatabaseAccess } from "@/lib/auth";
import { office } from "@/lib/office";

export const dynamic = "force-dynamic";

/** The public site's contact details. Only these fields ever leave through this route. */
export async function GET() {
  const fallback = { whatsapp: office.whatsapp, phone: office.phone, address: office.address, mapUrl: null };
  try {
    const user = await systemUser();
    if (!user) return NextResponse.json(fallback);
    const row = await withDatabaseAccess(user, (tx) => tx.officeSetting.findUnique({
      where: { id: 1 },
      select: { officeWhatsapp: true, officeAddress: true, officeMapUrl: true },
    }));
    const whatsapp = row?.officeWhatsapp || office.whatsapp;
    return NextResponse.json({
      whatsapp,
      phone: office.phone || whatsapp,
      address: row?.officeAddress || office.address,
      mapUrl: row?.officeMapUrl ?? null,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(fallback);
  }
}
