// Daily logical backup, run by a Railway cron service. Works without pg_dump, so it cannot
// fail on a client/server version mismatch. Needs an admin URL to read past RLS.
// Usage: node scripts/backup.mjs                 writes BACKUP_DIR/reasonix-<date>.ndjson.gz
//        node scripts/backup.mjs restore <file>  loads a backup into an empty, migrated database
import { createReadStream, createWriteStream, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGunzip, createGzip } from "node:zlib";
import pg from "pg";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Set MIGRATION_DATABASE_URL.");
const directory = process.env.BACKUP_DIR || "./backups";
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);
const PAGE = 200;

const db = new pg.Client({ connectionString: url.replace(/\?.*$/, "") });
await db.connect();
const { rows: tables } = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);

const encode = (value) => (Buffer.isBuffer(value) ? { $bytes: value.toString("base64") } : value);
const decode = (value) => (value && typeof value === "object" && "$bytes" in value ? Buffer.from(value.$bytes, "base64") : value);

async function* dump() {
  for (const { tablename } of tables) {
    for (let offset = 0; ; offset += PAGE) {
      // Paged so large documents are never all in memory at once.
      const { rows } = await db.query(`SELECT * FROM "${tablename}" ORDER BY 1 LIMIT ${PAGE} OFFSET ${offset}`);
      for (const row of rows) yield `${JSON.stringify({ t: tablename, r: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encode(value)])) })}\n`;
      if (rows.length < PAGE) break;
    }
  }
}

async function backup() {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `reasonix-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson.gz`);
  await pipeline(Readable.from(dump()), createGzip(), createWriteStream(file));
  for (const name of readdirSync(directory)) {
    const candidate = path.join(directory, name);
    if (name.startsWith("reasonix-") && Date.now() - statSync(candidate).mtimeMs > KEEP_DAYS * 86_400_000) rmSync(candidate);
  }
  console.log(`Backup written: ${file} (${statSync(file).size} bytes)`);
}

async function restore(file) {
  const { rows: [{ cases, users }] } = await db.query(`SELECT (SELECT count(*) FROM "LegalCase") AS cases, (SELECT count(*) FROM "User") AS users`);
  if (cases !== "0" || users !== "0") throw new Error("Restore needs an empty database; nothing was changed.");
  await db.query("BEGIN");
  // Triggers and foreign keys are off for this session so rows can load in any order.
  await db.query("SET LOCAL session_replication_role = replica");
  await db.query(`DELETE FROM "OfficeSetting"`);
  await db.query(`DELETE FROM "MessageTemplate"`);
  await db.query(`DELETE FROM "DocumentTemplate"`);
  const columnTypes = new Map();
  const typesOf = async (table) => {
    if (!columnTypes.has(table)) {
      const { rows } = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1", [table]);
      columnTypes.set(table, new Map(rows.map((row) => [row.column_name, row.data_type])));
    }
    return columnTypes.get(table);
  };
  let count = 0;
  for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) {
    if (!line) continue;
    const { t: table, r: row } = JSON.parse(line);
    const types = await typesOf(table);
    const columns = Object.keys(row);
    const values = columns.map((column) => (types.get(column) === "jsonb" && row[column] !== null ? JSON.stringify(row[column]) : decode(row[column])));
    await db.query(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`, values);
    count += 1;
  }
  await db.query("COMMIT");
  console.log(`Restored ${count} rows.`);
}

try {
  if (process.argv[2] === "restore") await restore(process.argv[3]);
  else await backup();
} finally {
  await db.end();
}
