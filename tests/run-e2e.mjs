// Full end-to-end run on a throwaway database: migrate, seed, serve the production build
// with mock Claude and WhatsApp servers, run the checks, clean up. Run `npm run build` first.
import { execFileSync, spawn } from "node:child_process";
import pg from "pg";

const adminBase = process.env.E2E_DATABASE_URL || "postgresql://reasonix:reasonix-local@localhost:54329/postgres";
const database = "reasonix_e2e";
const url = adminBase.replace(/\/postgres$/, `/${database}`);
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: `${url}?schema=public`,
  INITIAL_LAWYER_EMAIL: "alaa@reasonix.local",
  INITIAL_LAWYER_PASSWORD: "LocalDemo-2026!",
  FIELD_ENCRYPTION_KEY: "e2e-only-key",
  ANTHROPIC_API_KEY: "mock",
  ANTHROPIC_BASE_URL: "http://localhost:4599",
  AI_COMPAT_BASE: "http://localhost:4599/compat",
  WHATSAPP_TOKEN: "mock",
  WHATSAPP_PHONE_NUMBER_ID: "1",
  WHATSAPP_APP_SECRET: "test-secret",
  WHATSAPP_VERIFY_TOKEN: "verify",
  WHATSAPP_API_BASE: "http://localhost:4600",
};

async function recreate() {
  const admin = new pg.Client({ connectionString: adminBase });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
}

const run = (command, args) => execFileSync(command, args, { stdio: "inherit", env, shell: true });
await recreate();
run("npx", ["prisma", "migrate", "deploy"]);
run("npx", ["tsx", "prisma/seed-demo.ts"]);

const children = [
  spawn(process.execPath, ["tests/mocks/claude.mjs", "tests/mocks/claude.log"], { env, stdio: "ignore" }),
  spawn(process.execPath, ["tests/mocks/whatsapp.mjs"], { env, stdio: "ignore" }),
  spawn("npx", ["next", "start", "-p", "3100"], { env, stdio: "inherit", shell: true }),
];

let code = 1;
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await fetch("http://localhost:3100/api/health").then((response) => response.ok).catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  execFileSync(process.execPath, ["tests/api.e2e.mjs"], { stdio: "inherit", env });
  code = 0;
} catch {
  code = 1;
} finally {
  for (const child of children) child.kill();
  if (process.platform === "win32") {
    try { execFileSync("powershell", ["-NoProfile", "-Command", "Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"], { stdio: "ignore" }); } catch { /* already gone */ }
  }
}
process.exit(code);
