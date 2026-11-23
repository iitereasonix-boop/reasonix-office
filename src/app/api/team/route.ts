import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { HttpError, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(200),
  role: z.enum([Role.SENIOR_LAWYER, Role.TRAINEE_LAWYER, Role.SECRETARY]),
});

export const GET = route(staffRoles, async (user, request) => {
  const everyone = request.nextUrl.searchParams.get("all") === "1" && user.role === Role.SENIOR_LAWYER;
  const staff = await prisma.user.findMany({
    where: everyone ? { role: { not: Role.CLIENT } } : { active: true, role: { not: Role.CLIENT } },
    select: { id: true, name: true, role: true, active: true, ...(everyone ? { email: true } : {}) },
    orderBy: { name: "asc" },
  });
  return { staff };
});

export const POST = route([Role.SENIOR_LAWYER], async (user, request) => {
  const { password, ...details } = await parseBody(request, schema, "راجع اسم الموظف وبريده وكلمة مروره (10 محارف على الأقل).");
  try {
    const employee = await prisma.user.create({
      data: {
        ...details,
        passwordHash: await bcrypt.hash(password, 12),
        canViewPrivateNotes: details.role === Role.SENIOR_LAWYER,
        canViewNationalId: details.role === Role.SENIOR_LAWYER,
      },
      select: { id: true, name: true, role: true },
    });
    await logAudit(user, "STAFF_CREATED", "User", employee.id, { role: employee.role });
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new HttpError("هذا البريد الإلكتروني مسجل مسبقاً.", 409);
    }
    throw error;
  }
});

const updateSchema = z.union([
  z.object({ active: z.boolean() }),
  z.object({ password: z.string().min(10).max(200) }),
]);

export const PATCH = route([Role.SENIOR_LAWYER], async (user, request) => {
  const id = requireId(request);
  const input = await parseBody(request, updateSchema, "بيانات غير صالحة. كلمة المرور 10 محارف على الأقل.");
  if (id === user.id) throw new HttpError("لا يمكنك تعديل حسابك من هنا. استخدم قسم «حسابي» في الإعدادات.");
  const employee = await prisma.user.findFirst({ where: { id, role: { not: Role.CLIENT } }, select: { id: true } });
  if (!employee) throw new HttpError("الموظف غير موجود.", 404);
  if ("password" in input) {
    await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(input.password, 12) } });
    // A reset ends every open session, so a leaked password stops working at once.
    await prisma.session.deleteMany({ where: { userId: id } });
    await logAudit(user, "STAFF_PASSWORD_RESET", "User", id);
    return { ok: true };
  }
  await prisma.user.update({ where: { id }, data: { active: input.active } });
  if (!input.active) await prisma.session.deleteMany({ where: { userId: id } });
  await logAudit(user, input.active ? "STAFF_ACTIVATED" : "STAFF_DEACTIVATED", "User", id);
  return { ok: true };
});
