/**
 * Test the Playwright-based Gartner scraper.
 *
 * Usage:
 *   npx tsx scripts/test-gartner.ts                     # scrape only (headless)
 *   PLAYWRIGHT_HEADFUL=1 npx tsx scripts/test-gartner.ts  # scrape + discover (headful)
 */
import { scrapeGartnerInsights, discoverGartnerUrl } from "../src/lib/gartner/scraper";

async function main() {
  // Discovery only works in headful mode (DDG shows CAPTCHA in headless)
  if (process.env.PLAYWRIGHT_HEADFUL) {
    console.log("=== Discover Gartner URL ===");
    const discovered = await discoverGartnerUrl("CrowdStrike");
    console.log("Discovered:", discovered);
  }

  // Scrape a known URL (works in headless)
  const testUrl =
    process.argv[2] ||
    "https://www.gartner.com/reviews/market/endpoint-protection-platforms/vendor/crowdstrike/product/crowdstrike-falcon/likes-dislikes";

  console.log("\n=== Scrape Gartner Insights ===");
  console.log("URL:", testUrl);
  const insights = await scrapeGartnerInsights(testUrl);

  console.log(`\nResults: ${insights.length} insights`);
  for (const insight of insights) {
    console.log(`\n[${insight.type.toUpperCase()}]`);
    console.log(`  Text: ${insight.text.slice(0, 120)}...`);
    console.log(`  Role: ${insight.reviewerRole}`);
    console.log(`  Industry: ${insight.reviewerIndustry}`);
  }
}

main().catch(console.error);
