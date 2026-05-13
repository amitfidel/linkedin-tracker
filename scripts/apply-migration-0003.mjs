/**
 * One-off: apply drizzle migration 0003 (client-watch tables + category column)
 * to the Turso DB and backfill existing rows' category.
 *
 *   node scripts/apply-migration-0003.mjs
 */
import { createClient } from "@libsql/client";
import { config } from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const turso = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const sqlPath = path.resolve(
  __dirname,
  "../drizzle/0003_sparkling_eternity.sql",
);
const sql = readFileSync(sqlPath, "utf8");

// drizzle separates statements with `--> statement-breakpoint`
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`applying ${statements.length} statements from 0003…`);
for (const stmt of statements) {
  const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
  console.log("  →", preview);
  try {
    await turso.execute(stmt);
  } catch (e) {
    const msg = e?.message ?? String(e);
    // Tolerate "already exists" if you re-run
    if (/already exists|duplicate column/i.test(msg)) {
      console.log("    (skipped, already applied)");
      continue;
    }
    throw e;
  }
}

// Backfill the category column on existing rows.
console.log("\nbackfilling category…");
const updates = [
  {
    label: "competitor",
    sql: `UPDATE companies SET category='competitor' WHERE lower(name) IN ('armis','claroty')`,
  },
  {
    label: "self",
    sql: `UPDATE companies SET category='self' WHERE lower(name) IN ('sepio','agrint')`,
  },
];
for (const u of updates) {
  const res = await turso.execute(u.sql);
  console.log(`  ${u.label}: ${res.rowsAffected} rows`);
}

// Sanity check
const check = await turso.execute(
  "SELECT name, category FROM companies ORDER BY id",
);
console.log("\ncurrent categories:");
for (const row of check.rows) {
  console.log(`  #${row.id ?? "?"} ${row.name} → ${row.category}`);
}

console.log("\n✅ done.");
process.exit(0);
