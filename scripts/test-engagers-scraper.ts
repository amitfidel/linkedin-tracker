/**
 * Standalone test for the engagers scraper.
 *
 *   npx tsx scripts/test-engagers-scraper.ts                   # picks 2 random recent competitor posts
 *   npx tsx scripts/test-engagers-scraper.ts urn:li:activity:1234567890
 *   PLAYWRIGHT_HEADFUL=1 npx tsx scripts/test-engagers-scraper.ts   # see the browser
 */
import "dotenv/config";
import { scrapeEngagers } from "../src/lib/linkedin/engagers-scraper";
import { db } from "../src/db";
import { companies, companyPosts } from "../src/db/schema";
import { and, eq, desc, gte } from "drizzle-orm";

function extractActivityId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /activity[:-](\d{10,})/.exec(url);
  return m?.[1] ?? null;
}

async function main() {
  const argUrn = process.argv.slice(2).find((a) => a.startsWith("urn:"));

  let urns: string[];
  if (argUrn) {
    urns = [argUrn];
  } else {
    const fourteenDaysAgo = new Date(
      Date.now() - 14 * 86400_000,
    ).toISOString();
    const rows = await db
      .select({
        url: companyPosts.linkedinPostId,
        postedAt: companyPosts.postedAt,
      })
      .from(companyPosts)
      .innerJoin(companies, eq(companyPosts.companyId, companies.id))
      .where(
        and(
          eq(companies.category, "competitor"),
          gte(companyPosts.postedAt, fourteenDaysAgo),
        ),
      )
      .orderBy(desc(companyPosts.postedAt))
      .limit(2)
      .all();
    urns = rows
      .map((r) => extractActivityId(r.url))
      .filter((id): id is string => !!id)
      .map((id) => `urn:li:activity:${id}`);
  }

  if (!urns.length) {
    console.error("no test URNs available — pass one explicitly or run a posts scrape first.");
    process.exit(1);
  }

  console.log(`testing on: ${urns.join(", ")}\n`);
  const t0 = Date.now();
  const result = await scrapeEngagers(urns, { maxLikesPerPost: 50 });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nfetched ${result.data.length} engagements in ${dt}s`);
  const counts: Record<string, Record<string, number>> = {};
  for (const e of result.data) {
    counts[e.urn] ??= {};
    counts[e.urn][e.engagementType] = (counts[e.urn][e.engagementType] ?? 0) + 1;
  }
  for (const [urn, byType] of Object.entries(counts)) {
    console.log(`${urn}: ${JSON.stringify(byType)}`);
  }
  console.log("\nsample:");
  for (const e of result.data.slice(0, 5)) {
    console.log(
      `  [${e.engagementType}] ${e.engagerName} — ${e.engagerHeadline ?? "(no headline)"} — ${e.engagerLinkedinUrl}`,
    );
    if (e.commentText)
      console.log(
        `    > ${e.commentText.slice(0, 120).replace(/\s+/g, " ")}`,
      );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
