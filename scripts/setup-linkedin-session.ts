/**
 * One-time setup: launch Playwright Chrome with a dedicated profile, let
 * you log into LinkedIn manually, then save the session.
 *
 *   npx tsx scripts/setup-linkedin-session.ts
 *
 * After the page reaches the LinkedIn feed (i.e. you're logged in), close
 * the window. The session lives in <project>/.playwright-data/linkedin/
 * and is reused by all subsequent headless scrapes.
 *
 * Re-run this whenever the scraper reports "session expired".
 */
import "dotenv/config";
import { mkdirSync } from "fs";
import { chromium } from "playwright-core";
import { PROFILE_DIR } from "../src/lib/linkedin/posts-scraper";

async function main() {
  mkdirSync(PROFILE_DIR, { recursive: true });
  console.log(`profile dir: ${PROFILE_DIR}`);

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://www.linkedin.com/login", {
    waitUntil: "domcontentloaded",
  });

  console.log("");
  console.log("=========================================================");
  console.log(" Log in manually in the window.");
  console.log(" Once you reach https://www.linkedin.com/feed/, the");
  console.log(" session is saved — close the window or press Ctrl+C.");
  console.log("=========================================================");
  console.log("");

  // Poll URL — once we reach /feed/ we know login completed.
  let loggedIn = false;
  for (let i = 0; i < 600; i++) {
    // up to 10 minutes of waiting
    const url = page.url();
    if (url.includes("/feed/") || url.includes("/in/")) {
      loggedIn = true;
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (loggedIn) {
    console.log("✅ logged in. session saved to", PROFILE_DIR);
    console.log("   You can now close the window. Headless scrapes will reuse this session.");
  } else {
    console.log("⚠️  did not detect login within 10 minutes — closing.");
  }

  await page.waitForTimeout(2000);
  await ctx.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
