import { chromium } from "playwright-core";

export interface GartnerInsight {
  type: "like" | "dislike";
  text: string;
  reviewUrl: string;
  reviewerRole?: string;
  reviewerIndustry?: string;
}

const GARTNER_LOGIN_URL = "https://www.gartner.com/peer-insights/login/reviews";

function getChromiumPath(): string | undefined {
  // Let Playwright use its own installed chromium (via `npx playwright install chromium`).
  // Only override if a system binary is explicitly set via env var.
  return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? undefined;
}

async function loginToGartner(page: import("playwright-core").Page): Promise<boolean> {
  const email = process.env.GARTNER_EMAIL;
  const password = process.env.GARTNER_PASSWORD;
  if (!email || !password) {
    console.warn("[Gartner] GARTNER_EMAIL or GARTNER_PASSWORD not set");
    return false;
  }

  await page.goto(GARTNER_LOGIN_URL, { waitUntil: "networkidle", timeout: 30000 });

  try {
    // Step 1: fill email using label-based locator (robust across frameworks)
    await page.getByLabel("Email").fill(email);

    // Step 2: click "Log in with password instead"
    await page.getByText("Log in with password instead").click({ timeout: 8000 });

    // Step 3: fill password
    await page.getByLabel("Password").fill(password);

    // Step 4: submit — click the visible submit/sign-in button
    await page.getByRole("button", { name: /sign in|log in/i }).click({ timeout: 5000 });

    // Wait for successful redirect away from login page
    await page.waitForURL(
      (url) => !url.toString().includes("login") && !url.toString().includes("authenticate"),
      { timeout: 20000 }
    );

    console.log("[Gartner] Login successful, current URL:", page.url());
    return true;
  } catch (e) {
    console.warn("[Gartner] Login failed:", e instanceof Error ? e.message : e);
    console.warn("[Gartner] Current URL at failure:", page.url());
    try {
      const title = await page.title();
      console.warn("[Gartner] Page title:", title);
      const bodyText = await page.$eval("body", (el) =>
        (el as HTMLElement).innerText?.replace(/\s+/g, " ").slice(0, 500)
      ).catch(() => "N/A");
      console.warn("[Gartner] Page body text:", bodyText);
      const html = await page.content();
      const inputTags = html.match(/<input[^>]*>/gi)?.slice(0, 5).join("\n") ?? "no inputs found";
      console.warn("[Gartner] Input tags found:", inputTags);
    } catch {}
    return false;
  }
}

/** Extract review URL + full like/dislike text from an individual review page */
async function extractReviewInsights(
  page: import("playwright-core").Page
): Promise<{ likeText: string; dislikeText: string; reviewerRole: string; reviewerIndustry: string }> {
  const answers = await page.$$eval("p.answer", (els) =>
    els.map((el) => (el as HTMLElement).innerText?.trim() ?? "")
  );

  const reviewerText = await page.$eval(
    "aside",
    (el) => (el as HTMLElement).innerText ?? ""
  ).catch(() => "");

  // Parse reviewer role and industry from aside text
  // Format: "Reviewer Profile\n{Role}\nIndustry:\n{Industry}\n..."
  const roleMatch = reviewerText.match(/Reviewer Profile\s*\n([^\n]+)/);
  const industryMatch = reviewerText.match(/Industry:\s*\n([^\n]+)/);

  return {
    likeText: answers[0] ?? "",
    dislikeText: answers[1] ?? "",
    reviewerRole: roleMatch?.[1]?.trim() ?? "",
    reviewerIndustry: industryMatch?.[1]?.trim() ?? "",
  };
}

export async function scrapeGartnerInsights(
  gartnerUrl: string,
  /** Review URLs already in DB — skip these to avoid re-scraping */
  existingReviewUrls: Set<string> = new Set()
): Promise<GartnerInsight[]> {
  const executablePath = getChromiumPath();

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  // Hide webdriver flag so bot-detection doesn't block form rendering
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  });

  const page = await context.newPage();

  try {
    // Always log in first so the session is established before navigating to the target page
    const ok = await loginToGartner(page);
    if (!ok) {
      console.warn("[Gartner] Login failed or credentials not set — skipping");
      return [];
    }

    // Navigate to the likes/dislikes page
    await page.goto(gartnerUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page.waitForSelector(".review", { timeout: 20000 });

    // Collect top 3 likes and top 3 dislikes (in page order — most recent first)
    const cards = await page.$$(".review");
    const toScrape: Array<{ type: "like" | "dislike"; index: number }> = [];
    let likeCount = 0, dislikeCount = 0;

    for (let i = 0; i < cards.length; i++) {
      if (likeCount >= 3 && dislikeCount >= 3) break;
      const label = await cards[i].$eval(
        ".dot-and-title-inner",
        (el) => (el as HTMLElement).innerText?.trim()
      ).catch(() => "");

      if (label === "LIKES" && likeCount < 3) {
        toScrape.push({ type: "like", index: i });
        likeCount++;
      } else if (label === "DISLIKES" && dislikeCount < 3) {
        toScrape.push({ type: "dislike", index: i });
        dislikeCount++;
      }
    }

    const results: GartnerInsight[] = [];

    for (const { type, index } of toScrape) {
      try {
        // Re-query cards after each navigation (page may have re-rendered)
        await page.goto(gartnerUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForSelector(".review", { timeout: 15000 });

        const freshCards = await page.$$(".review");
        const card = freshCards[index];
        if (!card) continue;

        // Click "Read Full Review" button
        const btn = await card.$("button");
        if (!btn) continue;

        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
          btn.click(),
        ]);

        const reviewUrl = page.url();

        // Skip if already scraped
        if (existingReviewUrls.has(reviewUrl)) {
          console.log(`[Gartner] Already scraped: ${reviewUrl}`);
          continue;
        }

        // Wait for review content to load
        await page.waitForSelector("p.answer", { timeout: 10000 });

        const { likeText, dislikeText, reviewerRole, reviewerIndustry } =
          await extractReviewInsights(page);

        const text = type === "like" ? likeText : dislikeText;
        if (!text) continue;

        results.push({ type, text, reviewUrl, reviewerRole, reviewerIndustry });
      } catch (e) {
        console.warn(`[Gartner] Failed to scrape review #${index}:`, e instanceof Error ? e.message : e);
      }
    }

    return results;
  } finally {
    await browser.close();
  }
}
