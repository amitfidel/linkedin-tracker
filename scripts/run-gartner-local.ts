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

const RAILWAY_URL =
  process.argv[2] || "https://linkedin-tracker-production-4f02.up.railway.app";

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

  // Scrape all companies locally
  const allInsights: Array<{
    companyId: number;
    type: "like" | "dislike";
    text: string;
    reviewUrl: string;
    reviewerRole: string;
    reviewerIndustry: string;
  }> = [];

  for (const company of gartnerCompanies) {
    console.log(`\n=== Scraping ${company.name} ===`);
    try {
      const insights = await scrapeGartnerInsights(company.gartnerUrl!);
      console.log(`Got ${insights.length} insights`);
      for (const i of insights) {
        allInsights.push({
          companyId: company.id,
          type: i.type,
          text: i.text,
          reviewUrl: i.reviewUrl,
          reviewerRole: i.reviewerRole ?? "",
          reviewerIndustry: i.reviewerIndustry ?? "",
        });
      }
    } catch (e) {
      console.error(
        `Failed for ${company.name}:`,
        e instanceof Error ? e.message : e
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
