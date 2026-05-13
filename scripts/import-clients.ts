/**
 * Imports the Sepio client list from a CSV file.
 *
 *   npx tsx scripts/import-clients.ts            # defaults to ./clients.csv
 *   npx tsx scripts/import-clients.ts path/to/clients.csv
 *
 * CSV format (with or without header):
 *   name,linkedinUrl
 *   JP Morgan Chase,https://www.linkedin.com/company/jpmorganchase
 *
 * Idempotent — re-running upserts. Existing rows have their `category` set to
 * 'client' even if they were previously 'tracked' (rare but handled).
 */
import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { db } from "../src/db";
import { companies } from "../src/db/schema";
import { eq } from "drizzle-orm";

function normaliseUrl(url: string): string {
  return url
    .trim()
    .replace(/\s+/g, "")
    .replace(/\/$/, "")
    .toLowerCase()
    .replace(/^http:/, "https:");
}

function parseCsv(text: string): Array<{ name: string; linkedinUrl: string }> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const rows: Array<{ name: string; linkedinUrl: string }> = [];
  for (const line of lines) {
    // Skip header row if present
    if (/^name\s*,\s*linkedinurl\b/i.test(line)) continue;

    // Naive CSV parse — clients.csv is small, no embedded commas expected.
    // If you have commas in names, quote them: "Acme, Inc.",https://...
    let cols: string[];
    if (line.startsWith('"')) {
      const m = /^"([^"]*)"\s*,\s*(.+)$/.exec(line);
      cols = m ? [m[1], m[2]] : line.split(",");
    } else {
      cols = line.split(",");
    }
    if (cols.length < 2) {
      console.warn(`  skip (bad row): ${line}`);
      continue;
    }
    const name = cols[0].trim();
    const linkedinUrl = normaliseUrl(cols[1]);
    if (!name || !linkedinUrl.includes("linkedin.com")) {
      console.warn(`  skip (invalid url): ${line}`);
      continue;
    }
    if (linkedinUrl.includes("/search/results/")) {
      console.warn(
        `  ⚠ placeholder URL kept (no real company page yet): ${name}`,
      );
    }
    rows.push({ name, linkedinUrl });
  }
  return rows;
}

async function main() {
  const csvPath = path.resolve(process.argv[2] ?? "clients.csv");
  if (!existsSync(csvPath)) {
    console.error(`❌ no CSV at ${csvPath}`);
    console.error("create one with columns: name,linkedinUrl");
    process.exit(1);
  }

  const text = readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  console.log(`parsed ${rows.length} rows from ${csvPath}`);

  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    const existing = await db
      .select({ id: companies.id, category: companies.category })
      .from(companies)
      .where(eq(companies.linkedinUrl, r.linkedinUrl))
      .get();

    if (existing) {
      if (existing.category === "client") {
        console.log(`  · ${r.name} — already a client (#${existing.id})`);
      } else {
        await db
          .update(companies)
          .set({ category: "client", name: r.name, isActive: true })
          .where(eq(companies.id, existing.id));
        console.log(
          `  → promoted #${existing.id} ${r.name} from ${existing.category} → client`,
        );
        updated++;
      }
      continue;
    }

    await db.insert(companies).values({
      name: r.name,
      linkedinUrl: r.linkedinUrl,
      category: "client",
      isActive: true,
    });
    console.log(`  + inserted ${r.name}`);
    inserted++;
  }

  console.log(`\n✅ done. inserted: ${inserted}, promoted: ${updated}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
