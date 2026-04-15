/**
 * Run the Gartner scraper locally using Chrome, then push results to the
 * deployed Railway app via the /api/scrape/gartner-push endpoint.
 *
 * Usage:
 *   npx tsx scripts/run-gartner-local.ts
 *   npx tsx scripts/run-gartner-local.ts https://custom-url.railway.app
 */
import "dotenv/config";
import { db } from "../src/db";
import { companies } from "../src/db/schema";
import { scrapeGartnerInsights } from "../src/lib/gartner/scraper";
import { runPool } from "../src/lib/utils/pool";

const RAILWAY_URL =
  process.argv[2] || "https://linkedin-tracker-production-4f02.up.railway.app";

// Playwright is memory-heavy (~400 MB per browser). Concurrency 2 is safe on most machines.
const GARTNER_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.GARTNER_CONCURRENCY ?? "2", 10) || 2
);

async function main() {
  // Get companies with Gartner URLs from production DB
  const allCompanies = await db
    .select({
      id: companies.id,
      name: companies.name,
      gartnerUrl: companies.gartnerUrl,
    })
    .from(companies);

  const gartnerCompanies = allCompanies.filter((c) => c.gartnerUrl);
  console.log(`Found ${gartnerCompanies.length} companies with Gartner URLs:`);
  for (const c of gartnerCompanies) {
    console.log(`  - ${c.name}: ${c.gartnerUrl}`);
  }

  if (gartnerCompanies.length === 0) {
    console.log("No companies with Gartner URLs. Nothing to scrape.");
    return;
  }

  // Scrape all companies locally (parallel, bounded concurrency)
  console.log(`\nScraping with concurrency=${GARTNER_CONCURRENCY}...`);
  const results = await runPool(
    gartnerCompanies,
    async (company) => {
      console.log(`[start] ${company.name}`);
      const insights = await scrapeGartnerInsights(company.gartnerUrl!);
      console.log(`[done]  ${company.name} — ${insights.length} insights`);
      return { companyId: company.id, insights };
    },
    GARTNER_CONCURRENCY
  );

  const allInsights: Array<{
    companyId: number;
    type: "like" | "dislike";
    text: string;
    reviewUrl: string;
    reviewerRole: string;
    reviewerIndustry: string;
  }> = [];

  for (let idx = 0; idx < results.length; idx++) {
    const r = results[idx];
    const name = gartnerCompanies[idx].name;
    if (r.status === "fulfilled") {
      for (const i of r.value.insights) {
        allInsights.push({
          companyId: r.value.companyId,
          type: i.type,
          text: i.text,
          reviewUrl: i.reviewUrl,
          reviewerRole: i.reviewerRole ?? "",
          reviewerIndustry: i.reviewerIndustry ?? "",
        });
      }
    } else {
      console.error(
        `Failed for ${name}:`,
        r.reason instanceof Error ? r.reason.message : r.reason
      );
    }
  }

  if (allInsights.length === 0) {
    console.log("\nNo insights scraped. Nothing to push.");
    return;
  }

  // Push to Railway API
  console.log(
    `\n=== Pushing ${allInsights.length} insights to ${RAILWAY_URL} ===`
  );
  try {
    const res = await fetch(`${RAILWAY_URL}/api/scrape/gartner-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insights: allInsights }),
    });

    const data = await res.json();
    if (res.ok) {
      console.log(
        `Success! ${data.newInsights} new, ${data.skipped} skipped (dups), ${data.companies} companies`
      );
    } else {
      console.error("Push failed:", data.error);
    }
  } catch (e) {
    console.error(
      "Push failed:",
      e instanceof Error ? e.message : e
    );
  }

  console.log("\nDone!");
}

main().catch(console.error);
