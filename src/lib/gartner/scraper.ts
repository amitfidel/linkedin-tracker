import { chromium } from "playwright-core";

export interface GartnerInsight {
  type: "like" | "dislike";
  text: string;
  reviewUrl: string;
  reviewerRole?: string;
  reviewerIndustry?: string;
}

function getChromiumPath(): string | undefined {
  return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? undefined;
}

/**
 * Scrape Gartner Peer Insights likes/dislikes from a public vendor page.
 * NO LOGIN REQUIRED — the likes/dislikes list page is publicly accessible.
 * Expands truncated text by clicking the inline "..." expand links.
 * Deduplication is handled upstream via textHash — this always returns the top cards.
 */
export async function scrapeGartnerInsights(
  gartnerUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _existingReviewUrls: Set<string> = new Set()
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

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    console.log("[Gartner] Navigating to:", gartnerUrl);
    await page.goto(gartnerUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for the review regions to appear
    try {
      await page.waitForSelector('[role="region"]', { timeout: 20000 });
    } catch {
      console.warn("[Gartner] No review regions found on page:", gartnerUrl);
      return [];
    }

    // Expand all truncated text by clicking every "read more" inline link
    // These are <a href="javascript:void(0)"> inside the truncation spans
    const expandLinks = await page.$$('a[href="javascript:void(0)"]');
    console.log(`[Gartner] Found ${expandLinks.length} expand links — clicking all`);
    for (const link of expandLinks) {
      await link.click().catch(() => {/* some may not be visible */});
    }
    // Small pause for DOM updates
    await page.waitForTimeout(500);

    // Extract like/dislike text from the first 3 review region cards
    const reviews = await page.$$eval(
      '[role="region"]',
      (regions: Element[]) =>
        regions.slice(0, 3).map((region, idx) => {
          // Helper: get text content of the first generic element after a heading
          const getTextAfterHeading = (headingText: string): string => {
            const headings = Array.from(region.querySelectorAll('[role="heading"]'));
            const heading = headings.find(
              (h) => (h.textContent ?? "").toLowerCase().includes(headingText)
            );
            if (!heading) return "";

            // Walk siblings to find the text node element (skips date/button siblings)
            let el = heading.nextElementSibling;
            while (el) {
              const tag = el.tagName.toLowerCase();
              const role = el.getAttribute("role");
              // Skip headings and buttons; first non-button sibling is the text
              if (tag !== "button" && role !== "button" && role !== "heading") {
                return (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
              }
              el = el.nextElementSibling;
            }
            return "";
          };

          const likeText = getTextAfterHeading("like");
          const dislikeText = getTextAfterHeading("dislike");

          return { idx, likeText, dislikeText };
        })
    );

    console.log(`[Gartner] Extracted ${reviews.length} review pairs from ${gartnerUrl}`);

    const results: GartnerInsight[] = [];

    for (const { idx, likeText, dislikeText } of reviews) {
      // Synthetic URL used only as a stable identifier — textHash dedup in orchestrator
      const syntheticUrl = `${gartnerUrl}#card-${idx}`;

      if (likeText) {
        results.push({
          type: "like",
          text: likeText,
          reviewUrl: syntheticUrl,
        });
      }
      if (dislikeText) {
        results.push({
          type: "dislike",
          text: dislikeText,
          reviewUrl: syntheticUrl,
        });
      }
    }

    return results;
  } catch (e) {
    console.warn("[Gartner] Scrape failed:", e instanceof Error ? e.message : e);
    return [];
  } finally {
    await browser.close();
  }
}
