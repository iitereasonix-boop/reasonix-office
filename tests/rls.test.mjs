// Database-level access checks: these bypass the API, so they prove the second boundary.
// Needs DATABASE_URL pointing at a database loaded with `npm run db:demo`, as a role
// without SUPERUSER or BYPASSRLS.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL.replace(/\?.*$/, "") });
let ids;

const as = async (role, userId, work, clientId = "") => {
  await db.query("BEGIN");
  try {
    await db.query("SELECT set_config('app.user_role', $1, true), set_config('app.user_id', $2, true), set_config('app.client_id', $3, true)", [role, userId, clientId]);
    return await work();
  } finally {
    await db.query("ROLLBACK");
  }
};
const count = async (table) => Number((await db.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);

before(async () => {
  await db.connect();
  // A role with no policy match reads nothing, so ids come through the senior identity.
  const senior = (await db.query(`SELECT id FROM "User" WHERE role = 'SENIOR_LAWYER' LIMIT 1`)).rows[0].id;
  const trainee = (await db.query(`SELECT id FROM "User" WHERE role = 'TRAINEE_LAWYER' LIMIT 1`)).rows[0].id;
  const secretary = (await db.query(`SELECT id FROM "User" WHERE role = 'SECRETARY' LIMIT 1`)).rows[0].id;
  const clientId = await as("SENIOR_LAWYER", senior, async () => (await db.query(`SELECT "clientId" FROM "LegalCase" WHERE "caseNumber" = '2026/124'`)).rows[0].clientId);
  ids = { senior, trainee, secretary, clientId };
});
after(() => db.end());

test("the connection cannot bypass RLS", async () => {
  const { rows } = await db.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
  assert.deepEqual(rows[0], { rolsuper: false, rolbypassrls: false });
});

test("no identity means no rows", async () => {
  await as("", "", async () => {
    for (const table of ["Client", "LegalCase", "Hearing", "Document", "Judgment", "Message", "Invoice", "AgentRun"]) assert.equal(await count(table), 0, table);
  });
});

test("senior sees every case", () => as("SENIOR_LAWYER", ids.senior, async () => assert.ok((await count("LegalCase")) >= 5)));

test("trainee sees only assigned cases and their documents", () => as("TRAINEE_LAWYER", ids.trainee, async () => {
  const { rows } = await db.query(`SELECT "caseNumber" FROM "LegalCase"`);
  assert.deepEqual(rows.map((row) => row.caseNumber), ["2026/124"]);
  assert.equal((await db.query(`SELECT count(*) FROM "Document" d WHERE d."caseId" NOT IN (SELECT id FROM "LegalCase")`)).rows[0].count, "0");
  assert.equal(await count("Hearing"), 3);
}));

test("trainee cannot change a case or approve a message", () => as("TRAINEE_LAWYER", ids.trainee, async () => {
  const update = await db.query(`UPDATE "LegalCase" SET title = 'x'`);
  assert.equal(update.rowCount, 0);
  await db.query("SAVEPOINT s");
  await assert.rejects(db.query(`UPDATE "Message" SET status = 'APPROVED'`), /row-level security/);
  await db.query("ROLLBACK TO s");
}));

test("secretary cannot see invoices, payments or the agent log", () => as("SECRETARY", ids.secretary, async () => {
  assert.equal(await count("Invoice"), 0);
  assert.equal(await count("Payment"), 0);
  assert.equal(await count("InvoiceInstallment"), 0);
  assert.equal(await count("AgentRun"), 0);
}));

test("secretary cannot record a judgment or change office settings", () => as("SECRETARY", ids.secretary, async () => {
  await db.query("SAVEPOINT s");
  await assert.rejects(db.query(`INSERT INTO "Judgment" (id, "caseId", title, "decidedAt", summary) SELECT 'j', id, 't', now(), 's' FROM "LegalCase" LIMIT 1`), /row-level security/);
  await db.query("ROLLBACK TO s");
  assert.equal((await db.query(`UPDATE "OfficeSetting" SET "aiEnabled" = true`)).rowCount, 0);
}));

test("a client sees only their own case and hearings", () => as("CLIENT", "portal-user", async () => {
  const { rows } = await db.query(`SELECT "caseNumber" FROM "LegalCase"`);
  assert.deepEqual(rows.map((row) => row.caseNumber), ["2026/124"]);
  assert.equal(await count("Hearing"), 3);
  for (const table of ["Document", "DocumentPage", "Judgment", "LegalDraft", "Message", "Task", "Invoice", "AuditLog", "CaseUpdate"]) assert.equal(await count(table), 0, table);
}, ids.clientId));

test("a client with no linked id sees nothing", () => as("CLIENT", "portal-user", async () => assert.equal(await count("LegalCase"), 0)));

test("the audit log and agent log are immutable", () => as("SENIOR_LAWYER", ids.senior, async () => {
  const audit = (await db.query(`INSERT INTO "AuditLog" (id, "userId", action, "entityType", "entityId") VALUES ('a1', $1, 'T', 'T', 'T') RETURNING id`, [ids.senior])).rows[0].id;
  await db.query(`INSERT INTO "AgentRun" (id, agent, "userId", input, status) VALUES ('r1', 'T', $1, '{}', 'ok')`, [ids.senior]);
  for (const sql of [`UPDATE "AuditLog" SET action = 'X' WHERE id = '${audit}'`, `DELETE FROM "AuditLog" WHERE id = '${audit}'`, `UPDATE "AgentRun" SET status = 'X' WHERE id = 'r1'`, `DELETE FROM "AgentRun" WHERE id = 'r1'`]) {
    // RLS has no UPDATE or DELETE policy, so the row is out of reach before the trigger runs.
    assert.equal((await db.query(sql)).rowCount, 0, sql);
  }
  assert.equal((await db.query(`SELECT action FROM "AuditLog" WHERE id = '${audit}'`)).rows[0].action, "T");
}));

test("AI stays off and no template auto-sends until the lawyer opts in", () => as("SENIOR_LAWYER", ids.senior, async () => {
  assert.equal((await db.query(`SELECT count(*) FROM "MessageTemplate" WHERE "autoSend"`)).rows[0].count, "0");
  assert.equal((await db.query(`SELECT count(*) FROM "DeadlineRule"`)).rows[0].count, "0");
}));

test("hours: each person logs and sees only their own, on cases they can see", () => as("TRAINEE_LAWYER", ids.trainee, async () => {
  const own = (await db.query(`SELECT id FROM "LegalCase" WHERE "caseNumber" = '2026/124'`)).rows[0].id;
  await db.query(`INSERT INTO "TimeEntry" (id, "caseId", "userId", minutes, "workedAt", description) VALUES ('t1', $1, $2, 30, now(), 'x')`, [own, ids.trainee]);
  assert.equal((await db.query(`SELECT count(*) FROM "TimeEntry" WHERE "userId" <> $1`, [ids.trainee])).rows[0].count, "0");
  for (const sql of [
    // Someone else's name, a case out of reach, or a pre-billed row.
    [`INSERT INTO "TimeEntry" (id, "caseId", "userId", minutes, "workedAt", description) VALUES ('t2', $1, $2, 30, now(), 'x')`, [own, ids.senior]],
    [`INSERT INTO "TimeEntry" (id, "caseId", "userId", minutes, "workedAt", description) SELECT 't3', id, $1, 30, now(), 'x' FROM "LegalCase" WHERE id <> $2 LIMIT 1`, [ids.trainee, own]],
  ]) {
    await db.query("SAVEPOINT s");
    const result = await db.query(...sql).catch((error) => error);
    // Out-of-reach cases are invisible to the SELECT, so that insert adds nothing.
    assert.ok(result instanceof Error ? /row-level security/.test(result.message) : result.rowCount === 0, sql[0]);
    await db.query("ROLLBACK TO s");
  }
  assert.equal((await db.query(`UPDATE "TimeEntry" SET minutes = 999`)).rowCount, 0);
}));

test("expenses are office-only and billing them is senior-only", async () => {
  await as("TRAINEE_LAWYER", ids.trainee, async () => {
    await db.query("SAVEPOINT s");
    await assert.rejects(db.query(`INSERT INTO "CaseExpense" (id, "caseId", amount, "spentAt", category, "createdById") SELECT 'e1', id, 5, now(), 'x', $1 FROM "LegalCase" LIMIT 1`, [ids.trainee]), /row-level security/);
    await db.query("ROLLBACK TO s");
  });
  await as("SECRETARY", ids.secretary, async () => {
    await db.query(`INSERT INTO "CaseExpense" (id, "caseId", amount, "spentAt", category, "createdById") SELECT 'e2', id, 5, now(), 'x', $1 FROM "LegalCase" LIMIT 1`, [ids.secretary]);
    assert.equal((await db.query(`UPDATE "CaseExpense" SET "invoiceId" = NULL WHERE id = 'e2'`)).rowCount, 0);
  });
});
