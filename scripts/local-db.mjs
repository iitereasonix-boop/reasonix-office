// Development-only Postgres, so the app can run without touching any installed server.
// Usage: node scripts/local-db.mjs [start|stop]
//
// The binaries are copied to an ASCII path because initdb cannot re-execute itself
// from this project's Arabic folder name. The app connects as a role that is neither
// superuser nor BYPASSRLS, because PostgreSQL silently skips RLS for superusers.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const root = process.env.LOCAL_DB_DIR || path.join(homedir(), ".reasonix-local-db");
const binaries = path.join(root, "native");
const dataDir = path.join(root, "data");
const bin = (name) => path.join(binaries, "bin", `${name}.exe`);
const port = Number(process.env.LOCAL_DB_PORT || 54331);
const adminPassword = "local-admin";

const isRunning = () => existsSync(bin("pg_ctl")) && spawnSync(bin("pg_ctl"), ["status", "-D", dataDir]).status === 0;

if (process.argv[2] === "stop") {
  if (isRunning()) execFileSync(bin("pg_ctl"), ["stop", "-D", dataDir, "-m", "fast", "-w"], { stdio: "inherit" });
  process.exit(0);
}

if (!existsSync(bin("initdb"))) {
  cpSync(path.resolve("node_modules/@embedded-postgres/windows-x64/native"), binaries, { recursive: true });
}

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  const temp = mkdtempSync(path.join(tmpdir(), "reasonix-"));
  const passwordFile = path.join(temp, "pw");
  writeFileSync(passwordFile, adminPassword);
  execFileSync(bin("initdb"), ["-D", dataDir, "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${passwordFile}`, "-E", "UTF8", "--locale=C"], { stdio: "ignore" });
  rmSync(temp, { recursive: true, force: true });
}

if (!isRunning()) {
  execFileSync(bin("pg_ctl"), ["start", "-D", dataDir, "-w", "-l", path.join(root, "server.log"), "-o", `-p ${port}`], { stdio: "ignore" });
}

const admin = new pg.Client({ host: "localhost", port, user: "postgres", password: adminPassword, database: "postgres" });
await admin.connect();
const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'reasonix'");
if (!role.rowCount) await admin.query("CREATE ROLE reasonix LOGIN CREATEDB PASSWORD 'reasonix-local' NOSUPERUSER NOBYPASSRLS");
const database = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'reasonix'");
if (!database.rowCount) await admin.query("CREATE DATABASE reasonix OWNER reasonix");
await admin.end();

console.log(`Local database ready: postgresql://reasonix:reasonix-local@localhost:${port}/reasonix`);
