import bcrypt from "bcryptjs";
import { z } from "zod";
import { HttpError, parseBody, route, staffRoles } from "@/lib/api";
import { logAudit } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(10).max(200).optional(),
});

export const PATCH = route(staffRoles, async (user, request) => {
  const { name, currentPassword, newPassword } = await parseBody(request, schema, "الاسم مطلوب، وكلمة المرور 10 محارف على الأقل.");
  const data: { name?: string; passwordHash?: string } = name ? { name } : {};
  if (newPassword) {
    const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!currentPassword || !(await bcrypt.compare(currentPassword, account.passwordHash))) {
      throw new HttpError("كلمة المرور الحالية غير صحيحة.");
    }
    data.passwordHash = await bcrypt.hash(newPassword, 12);
  }
  await prisma.user.update({ where: { id: user.id }, data });
  if (newPassword) await logAudit(user, "PASSWORD_CHANGED", "User", user.id);
  return { ok: true };
});
