import { Role } from "@prisma/client";
import { route } from "@/lib/api";
import { runReminders } from "@/lib/reminders";

export const POST = route([Role.SENIOR_LAWYER, Role.SECRETARY], async () => runReminders());
