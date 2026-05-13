/**
 * One-shot cleanup: removes duplicate companyPosts rows that share an
 * activity ID with another row for the same company. Caused by the URL-
 * format mismatch between the old Apify scraper (slug URLs) and the new
 * local Playwright scraper (URN URLs).
 *
 *   npx tsx scripts/dedupe-posts.ts          # dry-run, prints what it would do
 *   npx tsx scripts/dedupe-posts.ts --apply  # actually delete
 */
import "dotenv/config";
import { db } from "../src/db";
import { companyPosts } from "../src/db/schema";
import { eq, inArray } from "drizzle-orm";

function extractActivityId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /activity[:-](\d{10,})/.exec(url);
  return m?.[1] ?? null;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const all = await db.select().from(companyPosts).all();
  console.log(`scanned ${all.length} posts`);

  // Group by (companyId, activityId)
  const groups = new Map<string, typeof all>();
  let withId = 0;
  let withoutId = 0;
  for (const p of all) {
    const aid = extractActivityId(p.linkedinPostId);
    if (!aid) {
      withoutId++;
      continue;
    }
    withId++;
    const key = `${p.companyId}:${aid}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  console.log(`with activity id: ${withId}, without: ${withoutId}`);

  // Find duplicates: groups with size > 1
  const toDelete: number[] = [];
  let dupGroupCount = 0;
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    dupGroupCount++;
    // Keep the row with the most recent scrapedAt; delete the rest.
    rows.sort((a, b) => (b.scrapedAt ?? "").localeCompare(a.scrapedAt ?? ""));
    const [keep, ...drop] = rows;
    if (apply || dupGroupCount <= 5) {
      console.log(
        `  ${key}: keep #${keep.id} (scraped ${keep.scrapedAt}), drop ${drop.map((d) => `#${d.id}`).join(",")}`,
      );
    }
    for (const d of drop) toDelete.push(d.id);
  }
  console.log(`duplicate groups: ${dupGroupCount}, rows to delete: ${toDelete.length}`);

  if (!toDelete.length) {
    console.log("nothing to do.");
    return;
  }

  if (!apply) {
    console.log("\ndry-run only — re-run with --apply to delete.");
    return;
  }

  // Delete in batches of 100 to keep the SQL statement compact.
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    const res = await db
      .delete(companyPosts)
      .where(inArray(companyPosts.id, batch));
    deleted += batch.length;
    void res;
  }
  console.log(`✅ deleted ${deleted} duplicate rows.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
