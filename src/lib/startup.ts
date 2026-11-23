import { runReminders } from "@/lib/reminders";
import { assertNoRlsBypass } from "@/lib/settings";

const FIVE_MINUTES = 5 * 60_000;

/** Reminders run inside the app so the deployment needs no extra worker or queue. */
export async function startBackgroundWork() {
  if (process.env.NODE_ENV !== "production") return;
  if (!(await assertNoRlsBypass())) {
    console.error("FATAL: DATABASE_URL uses a SUPERUSER or BYPASSRLS role, which disables row level security.");
    process.exit(1);
  }
  const tick = () => runReminders().catch((error: unknown) => console.error("Reminder run failed", error));
  setInterval(tick, FIVE_MINUTES).unref();
  void tick();
}
