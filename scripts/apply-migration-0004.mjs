/**
 * Apply drizzle migration 0004 (people_observations table + alerted_at column).
 *   node scripts/apply-migration-0004.mjs
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

const sqlPath = path.resolve(__dirname, "../drizzle/0004_spotty_nuke.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`applying ${statements.length} statements from 0004…`);
for (const stmt of statements) {
  const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
  console.log("  →", preview);
  try {
    await turso.execute(stmt);
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (/already exists|duplicate column/i.test(msg)) {
      console.log("    (already applied)");
      continue;
    }
    throw e;
  }
}
console.log("\n✅ done.");
process.exit(0);
