// Runs at container start, before the app. Railway's default Postgres user is a superuser, which silently
// skips every RLS policy, so migrations run with that admin URL while the app connects
// as a restricted role created here.
//
// Needs MIGRATION_DATABASE_URL (admin) and APP_DB_PASSWORD. INITIAL_LAWYER_EMAIL and
// INITIAL_LAWYER_PASSWORD create the first account when the database has no users.
import { execFileSync } from "node:child_process";
import pg from "pg";

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const appPassword = process.env.APP_DB_PASSWORD;
const APP_ROLE = "reasonix_app";
if (!adminUrl || !appPassword) throw new Error("Set MIGRATION_DATABASE_URL and APP_DB_PASSWORD.");

const childEnv = { ...process.env, DATABASE_URL: adminUrl };
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: childEnv, shell: true });

const admin = new pg.Client({ connectionString: adminUrl.replace(/\?.*$/, "") });
await admin.connect();
const literal = (value) => admin.escapeLiteral(value);
const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
await admin.query(`${exists.rowCount ? "ALTER" : "CREATE"} ROLE ${APP_ROLE} LOGIN PASSWORD ${literal(appPassword)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
const { rows: [{ current_database: database }] } = await admin.query("SELECT current_database()");
await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO ${APP_ROLE}`);
await admin.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
await admin.query(`REVOKE ALL ON "_prisma_migrations" FROM ${APP_ROLE}`);
const { rows: [{ count }] } = await admin.query(`SELECT count(*) FROM "User"`);
await admin.end();

if (count === "0" && process.env.INITIAL_LAWYER_EMAIL && process.env.INITIAL_LAWYER_PASSWORD) {
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "inherit", env: childEnv, shell: true });
}
console.log("Release finished.");
