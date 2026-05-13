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

const sql = readFileSync(
  path.resolve(__dirname, "../drizzle/0005_small_arclight.sql"),
  "utf8",
);
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

for (const stmt of statements) {
  console.log("→", stmt.slice(0, 80));
  try {
    await turso.execute(stmt);
  } catch (e) {
    if (/already exists|duplicate column/i.test(e?.message ?? "")) {
      console.log("  (already applied)");
      continue;
    }
    throw e;
  }
}
console.log("✅ done");
process.exit(0);
