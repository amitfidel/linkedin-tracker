import { chromium } from "playwright-core";

export interface GartnerInsight {
  type: "like" | "dislike";
  text: string;
  date?: string;
}

const GARTNER_LOGIN_URL = "https://www.gartner.com/reviews/authenticate#login";

/** Returns the path to the system Chromium binary (installed via nixpacks on Railway) */
function getChromiumPath(): string | undefined {
  // On Railway (nixpkgs chromium), the binary lives here
  const candidates = [
    "/run/current-system/sw/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  const fs = require("fs") as typeof import("fs");
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined; // Let playwright-core find it itself (local dev)
}

async function loginToGartner(page: import("playwright-core").Page): Promise<boolean> {
  const email = process.env.GARTNER_EMAIL;
  const password = process.env.GARTNER_PASSWORD;
  if (!email || !password) return false;

  await page.goto(GARTNER_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  try {
    await page.fill('input[type="email"], input[name="email"], #username', email, { timeout: 10000 });
    await page.fill('input[type="password"], input[name="password"], #password', password, { timeout: 5000 });
    await page.click('button[type="submit"], input[type="submit"]', { timeout: 5000 });
    // Wait for redirect away from login page
    await page.waitForURL((url) => !url.toString().includes("authenticate"), { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

export async function scrapeGartnerInsights(gartnerUrl: string): Promise<GartnerInsight[]> {
  const executablePath = getChromiumPath();

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    // Try navigating directly first
    await page.goto(gartnerUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Check if redirected to login
    const currentUrl = page.url();
    if (currentUrl.includes("authenticate") || currentUrl.includes("login")) {
      const loggedIn = await loginToGartner(page);
      if (!loggedIn) {
        console.warn("[Gartner] Login failed or credentials not set — skipping");
        return [];
      }
      // Navigate back to the target page after login
      await page.goto(gartnerUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    }

    // Wait for review cards to appear
    await page.waitForSelector(".review", { timeout: 15000 });

    // Extract all likes and dislikes
    const insights = await page.evaluate(() => {
      const cards = document.querySelectorAll(".review");
      return Array.from(cards).map((card) => {
        const label = (card.querySelector(".dot-and-title-inner") as HTMLElement)?.innerText?.trim() ?? "";
        const text = (card.querySelector(".likesdislikes-text") as HTMLElement)?.innerText?.trim() ?? "";
        const date = (card.querySelector(".likesdislikes-date") as HTMLElement)?.innerText?.trim();
        return { label, text, date };
      });
    });

    return insights
      .filter((i) => i.text.length > 0)
      .map((i) => ({
        type: i.label === "LIKES" ? ("like" as const) : ("dislike" as const),
        text: i.text,
        date: i.date,
      }));
  } finally {
    await browser.close();
  }
}
