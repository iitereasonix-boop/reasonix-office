import { NextResponse } from "next/server";
import { Role, TaskPriority } from "@prisma/client";
import { z } from "zod";
import { HttpError, parseBody, requireId, route, staffRoles } from "@/lib/api";
import { logAudit, withDatabaseAccess } from "@/lib/auth";

const createSchema = z.object({
  title: z.string().trim().min(2).max(200),
  notes: z.string().trim().max(2000).optional(),
  priority: z.nativeEnum(TaskPriority).default(TaskPriority.NORMAL),
  dueAt: z.string().datetime().optional(),
  assigneeId: z.string().optional(),
  caseId: z.string().optional(),
});
const updateSchema = z.object({ completed: z.boolean().optional(), title: z.string().trim().min(2).max(200).optional(), priority: z.nativeEnum(TaskPriority).optional() });

export const GET = route(staffRoles, async (user) => {
  const tasks = await withDatabaseAccess(user, (tx) =>
    tx.task.findMany({
      where: { deletedAt: null },
      include: { assignee: { select: { id: true, name: true } }, legalCase: { select: { id: true, caseNumber: true } } },
      orderBy: [{ completedAt: { sort: "desc", nulls: "first" } }, { dueAt: "asc" }],
      take: 200,
    }),
  );
  return { tasks };
});

export const POST = route(staffRoles, async (user, request) => {
  const input = await parseBody(request, createSchema, "راجع بيانات المهمة.");
  const assigneeId = user.role === Role.TRAINEE_LAWYER ? user.id : input.assigneeId || user.id;
  const task = await withDatabaseAccess(user, async (tx) => {
    if (input.caseId) {
      const legalCase = await tx.legalCase.findFirst({ where: { id: input.caseId, deletedAt: null }, select: { id: true } });
      if (!legalCase) throw new HttpError("القضية غير موجودة أو غير متاحة.", 404);
    }
    return tx.task.create({ data: { ...input, assigneeId, dueAt: input.dueAt ? new Date(input.dueAt) : undefined } });
  });
  await logAudit(user, "TASK_CREATED", "Task", task.id, undefined, task.caseId ?? undefined);
  return NextResponse.json({ task }, { status: 201 });
});

export const PATCH = route(staffRoles, async (user, request) => {
  const id = requireId(request);
  const { completed, ...data } = await parseBody(request, updateSchema, "راجع بيانات المهمة.");
  const task = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.task.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new HttpError("المهمة غير موجودة.", 404);
    return tx.task.update({ where: { id }, data: { ...data, ...(completed === undefined ? {} : { completedAt: completed ? new Date() : null }) } });
  });
  await logAudit(user, "TASK_UPDATED", "Task", id, { completed }, task.caseId ?? undefined);
  return { task };
});

export const DELETE = route(staffRoles, async (user, request) => {
  const id = requireId(request);
  const task = await withDatabaseAccess(user, async (tx) => {
    const existing = await tx.task.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!existing) throw new HttpError("المهمة غير موجودة.", 404);
    return tx.task.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  await logAudit(user, "TASK_DELETED", "Task", id, undefined, task.caseId ?? undefined);
  return { ok: true };
});
