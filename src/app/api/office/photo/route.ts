import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/api";
import { logAudit, systemUser, withDatabaseAccess } from "@/lib/auth";
import { detectOfficePhotoMimeType, OFFICE_PHOTO_MAX_BYTES } from "@/lib/office-photo";

export const dynamic = "force-dynamic";

const defaultPhoto = () => new NextResponse(null, {
  status: 307,
  headers: { "Cache-Control": "no-store", Location: "/images/reasonix-portrait.svg" },
});

export async function GET() {
  const user = await systemUser();
  if (!user) return defaultPhoto();

  const photo = await withDatabaseAccess(user, (tx) => tx.officeSetting.findUnique({
    where: { id: 1 },
    select: { officePhoto: true, officePhotoMimeType: true },
  }));
  if (!photo?.officePhoto || !photo.officePhotoMimeType) return defaultPhoto();

  return new NextResponse(new Uint8Array(photo.officePhoto), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": photo.officePhotoMimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const POST = route([Role.SENIOR_LAWYER], async (user, request) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError("تعذر قراءة الصورة. أعد اختيار الملف.");
  }
  const file = form.get("photo");
  if (!(file instanceof File)) throw new HttpError("اختر صورة للمكتب.");
  if (file.size < 1 || file.size > OFFICE_PHOTO_MAX_BYTES) {
    throw new HttpError("يجب ألا يتجاوز حجم الصورة 5 ميغابايت.");
  }

  const content = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectOfficePhotoMimeType(content);
  if (!mimeType || file.type !== mimeType) {
    throw new HttpError("الصيغ المدعومة هي JPG وPNG وWebP فقط.");
  }

  await withDatabaseAccess(user, (tx) => tx.officeSetting.update({
    where: { id: 1 },
    data: { officePhoto: content, officePhotoMimeType: mimeType },
  }));
  await logAudit(user, "OFFICE_PHOTO_UPDATED", "OfficeSetting", "1", { mimeType, size: file.size });
  return { ok: true };
});

export const DELETE = route([Role.SENIOR_LAWYER], async (user) => {
  await withDatabaseAccess(user, (tx) => tx.officeSetting.update({
    where: { id: 1 },
    data: { officePhoto: null, officePhotoMimeType: null },
  }));
  await logAudit(user, "OFFICE_PHOTO_REMOVED", "OfficeSetting", "1");
  return { ok: true };
});
