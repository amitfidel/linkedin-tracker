/**
 * Quick sanity test for the local Playwright LinkedIn posts scraper.
 *
 *   npx tsx scripts/test-posts-scraper.ts
 *   npx tsx scripts/test-posts-scraper.ts https://www.linkedin.com/company/claroty
 *   PLAYWRIGHT_HEADFUL=1 npx tsx scripts/test-posts-scraper.ts   # see the browser
 */
import "dotenv/config";
import { scrapeCompanyPostsLocal } from "../src/lib/linkedin/posts-scraper";

async function main() {
  const argUrls = process.argv.slice(2).filter((a) => a.startsWith("http"));
  const urls = argUrls.length
    ? argUrls
    : ["https://www.linkedin.com/company/claroty"];

  console.log(`testing on: ${urls.join(", ")}`);
  const t0 = Date.now();
  const result = await scrapeCompanyPostsLocal(urls, 8);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nfetched ${result.data.length} posts in ${dt}s`);
  for (const p of result.data.slice(0, 5)) {
    console.log("---");
    console.log("url    :", p.url);
    console.log("date   :", p.date);
    console.log("author :", p.author);
    console.log("type   :", p.content_type);
    console.log(
      "likes/c/s:",
      `${p.likes ?? 0}/${p.comments_count ?? 0}/${p.shares_count ?? 0}`,
    );
    console.log("text   :", (p.text ?? "").slice(0, 160).replace(/\s+/g, " "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
