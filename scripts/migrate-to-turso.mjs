/**
 * migrate-to-turso.mjs
 * Copies all data from the local SQLite file into Turso.
 *
 * Usage (after setting DATABASE_URL + DATABASE_AUTH_TOKEN in .env):
 *   node scripts/migrate-to-turso.mjs
 */

import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

config(); // load .env

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localDbPath = path.resolve(__dirname, "../data/tracker.db");

const TURSO_URL = process.env.DATABASE_URL;
const TURSO_TOKEN = process.env.DATABASE_AUTH_TOKEN;

if (!TURSO_URL || TURSO_URL.startsWith("file:")) {
  console.error("❌  Set DATABASE_URL to your Turso libsql:// URL in .env before running this script.");
  process.exit(1);
}
if (!TURSO_TOKEN) {
  console.error("❌  Set DATABASE_AUTH_TOKEN in .env before running this script.");
  process.exit(1);
}

const local = new Database(localDbPath, { readonly: true });
const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

// ── Create schema on Turso ────────────────────────────────────────────────────
// Get the CREATE TABLE statements from the local DB
const tables = local
  .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'drizzle_%' ORDER BY rowid")
  .all();

const indexes = local
  .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
  .all();

console.log(`\n📦  Found ${tables.length} tables to migrate.\n`);

for (const table of tables) {
  console.log(`  Creating table: ${table.name}`);
  // Drop + recreate to get a clean slate
  await turso.execute(`DROP TABLE IF EXISTS \`${table.name}\``);
  await turso.execute(table.sql);
}

for (const idx of indexes) {
  try {
    await turso.execute(idx.sql);
  } catch {
    // Index may already exist — ignore
  }
}

// ── Copy data row by row ──────────────────────────────────────────────────────
let totalRows = 0;

for (const table of tables) {
  const rows = local.prepare(`SELECT * FROM \`${table.name}\``).all();
  if (rows.length === 0) {
    console.log(`  ${table.name}: 0 rows (skipped)`);
    continue;
  }

  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => "?").join(", ");
  const sql = `INSERT OR REPLACE INTO \`${table.name}\` (${cols.map(c => `\`${c}\``).join(", ")}) VALUES (${placeholders})`;

  // Turso batch — insert all rows in one round trip
  const statements = rows.map((row) => ({
    sql,
    args: cols.map((c) => row[c] ?? null),
  }));

  await turso.batch(statements, "write");
  console.log(`  ✅  ${table.name}: ${rows.length} rows`);
  totalRows += rows.length;
}

console.log(`\n🎉  Migration complete! ${totalRows} total rows copied to Turso.\n`);
