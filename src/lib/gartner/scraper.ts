import { chromium } from "playwright-core";

export interface GartnerInsight {
  type: "like" | "dislike";
  text: string;
  reviewUrl: string;
  reviewerRole?: string;
  reviewerIndustry?: string;
}

const HEADLESS = !process.env.PLAYWRIGHT_HEADFUL;

async function launchBrowser() {
  return chromium.launch({
    channel: "chrome",
    headless: HEADLESS,
  });
}

/**
 * Auto-discover a company's Gartner Peer Insights likes-dislikes URL.
 *
 * Uses Playwright + DuckDuckGo to find the URL without any paid proxy.
 */
export async function discoverGartnerUrl(
  companyName: string
): Promise<string | null> {
  console.log(`[Gartner:discover] Searching for Gartner URL: ${companyName}`);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    const query = `site:gartner.com/reviews ${companyName} likes-dislikes`;

    // DuckDuckGo HTML endpoint — works reliably in headful mode.
    // In headless mode DDG shows a CAPTCHA, so discovery may only work
    // when PLAYWRIGHT_HEADFUL=1 is set. This is acceptable since discovery
    // is a one-time operation per company (URL gets saved to the DB).
    await page.goto(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 }
    );

    // Extract all hrefs — DDG wraps links in /l/?uddg=<encoded_url>
    const gartnerUrls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => {
          const href = a.getAttribute("href") || "";
          if (href.includes("uddg=")) {
            try {
              const params = new URLSearchParams(href.split("?")[1]);
              return params.get("uddg") || "";
            } catch {
              return "";
            }
          }
          return href;
        })
        .filter((url) => url.includes("gartner.com/reviews/"));
    });

    console.log(`[Gartner:discover] Found ${gartnerUrls.length} Gartner URLs from DDG`);

    // Priority 1: URL that already has /likes-dislikes (most specific)
    const ldUrl = gartnerUrls.find((u) =>
      /\/reviews\/market\/[a-z0-9-]+\/vendor\/[a-z0-9-]+.*\/likes-dislikes/i.test(u)
    );
    if (ldUrl) {
      const match = ldUrl.match(
        /(\/reviews\/market\/[a-z0-9-]+\/vendor\/[a-z0-9-]+(?:\/product\/[a-z0-9-]+)?\/likes-dislikes)/i
      );
      if (match) {
        const url = `https://www.gartner.com${match[1]}`;
        console.log(`[Gartner:discover] Found likes-dislikes URL for ${companyName}: ${url}`);
        return url;
      }
    }

    // Priority 2: any vendor/product page — append /likes-dislikes
    const vpUrl = gartnerUrls.find((u) =>
      /\/reviews\/market\/[a-z0-9-]+\/vendor\/[a-z0-9-]+/i.test(u)
    );
    if (vpUrl) {
      const match = vpUrl.match(
        /(\/reviews\/market\/[a-z0-9-]+\/vendor\/[a-z0-9-]+(?:\/product\/[a-z0-9-]+)?)/i
      );
      if (match) {
        const base = match[1].replace(/\/likes-dislikes$/, "");
        const url = `https://www.gartner.com${base}/likes-dislikes`;
        console.log(`[Gartner:discover] Derived likes-dislikes URL for ${companyName}: ${url}`);
        return url;
      }
    }

    console.log(`[Gartner:discover] No Gartner URL found for ${companyName}`);
    return null;
  } catch (e) {
    console.warn("[Gartner:discover] Failed:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    await browser.close();
  }
}

/**
 * Scrape Gartner Peer Insights likes/dislikes using Playwright.
 *
 * Launches a real Chrome browser, navigates to the page, and extracts
 * review data from the DOM. No ScraperAPI or paid proxy needed.
 *
 * The page has two card types:
 *   1. "Overall review panel" cards at the top — labeled FAVORABLE/CRITICAL,
 *      with headline, role, industry, but review body is blurred/placeholder.
 *   2. "Review cards" lower on the page — have real summary text, headline,
 *      role, industry, but no explicit favorable/critical label.
 *
 * Strategy: extract from panel cards (type from label, text from headline),
 * then also extract from review cards (real summary text, infer type from
 * whether the card appeared near favorable/critical context or from rating).
 */
export async function scrapeGartnerInsights(
  gartnerUrl: string,
  _existingReviewUrls: Set<string> = new Set()
): Promise<GartnerInsight[]> {
  console.log("[Gartner] Scraping with Playwright:", gartnerUrl);

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(gartnerUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    // Wait for review cards to render (timeout is non-fatal — page may have no reviews)
    await page.waitForSelector("[class*='reviewCard']", { timeout: 15_000 }).catch(() => {
      console.log("[Gartner] No review cards found within timeout — page may have no reviews");
    });

    // Strategy 1: Try __NEXT_DATA__ JSON (best data when available)
    const nextDataInsights = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el) return null;
      try {
        const data = JSON.parse(el.textContent || "");
        const snippets =
          data?.props?.pageProps?.serverSideXHRData?.["vendor-snippets"];
        if (!snippets?.favorable && !snippets?.critical) return null;
        return snippets as {
          favorable?: Array<{
            reviewId: number;
            jobTitle?: string;
            function?: string;
            answers?: {
              "lessonslearned-like-most"?: string;
              "lessonslearned-dislike-most"?: string;
            };
          }>;
          critical?: Array<{
            reviewId: number;
            jobTitle?: string;
            function?: string;
            answers?: {
              "lessonslearned-like-most"?: string;
              "lessonslearned-dislike-most"?: string;
            };
          }>;
        };
      } catch {
        return null;
      }
    });

    if (nextDataInsights) {
      console.log("[Gartner] Extracted data from __NEXT_DATA__");
      return extractFromNextData(nextDataInsights, gartnerUrl);
    }

    // Strategy 2: Extract from rendered DOM using known Gartner class patterns
    console.log("[Gartner] __NEXT_DATA__ not available, extracting from DOM...");

    const domInsights = await page.evaluate((baseUrl: string) => {
      const results: Array<{
        type: "like" | "dislike";
        text: string;
        reviewUrl: string;
        reviewerRole: string;
        reviewerIndustry: string;
      }> = [];
      const seenTexts = new Set<string>();

      // ── Panel cards (top of page) ─────────────────────────────────────
      // These have FAVORABLE/CRITICAL labels. The body text is blurred
      // placeholder, but the headline is real and useful.
      // Class pattern: overall-review-panel_reviewCard__*
      const panelCards = document.querySelectorAll("[class*='overall-review-panel_reviewCard']");

      for (const card of panelCards) {
        // Determine type from the FAVORABLE/CRITICAL label
        const typeLabel =
          card.querySelector("[class*='reviewTypeRight']")?.textContent?.trim().toUpperCase() || "";
        const hasFavorableDot = card.querySelector("[class*='reviewTypeDot--favorable']");
        const hasCriticalDot = card.querySelector("[class*='reviewTypeDot--critical']");

        const type: "like" | "dislike" =
          typeLabel === "CRITICAL" || hasCriticalDot ? "dislike" : "like";

        // Headline is the most reliable text (not blurred)
        const headline =
          card.querySelector("[class*='reviewHeadline']")?.textContent?.trim()
            .replace(/^\u201c|\u201d$/g, "").replace(/^"|"$/g, "") || "";

        // Check if the summary is blurred (placeholder text)
        const summaryEl = card.querySelector("[class*='reviewSummary']");
        const isBlurred = summaryEl?.className?.includes("blurred") ?? true;
        const isPlaceholder = summaryEl?.textContent?.includes("placeholder") ?? false;
        const summaryText = (!isBlurred && !isPlaceholder) ? summaryEl?.textContent?.trim() : "";

        // Use real summary if available, otherwise use the headline
        const text = summaryText || headline;
        if (!text || text.length < 5) continue;
        if (seenTexts.has(text)) continue;
        seenTexts.add(text);

        const role =
          card.querySelector("[class*='reviewerRole']")?.textContent?.trim() || "";
        const industry =
          card.querySelector("[class*='reviewerCompanyIndustry']")?.textContent?.trim() || "";

        // If we don't have the FAVORABLE/CRITICAL dot, try to detect by rating
        const hasFavorable = hasFavorableDot !== null;
        const hasCritical = hasCriticalDot !== null;

        results.push({
          type: hasCritical ? "dislike" : hasFavorable ? "like" : type,
          text,
          reviewUrl: baseUrl,
          reviewerRole: role,
          reviewerIndustry: industry,
        });
      }

      // ── Review cards (lower section, real text) ───────────────────────
      // Class pattern: review-card_reviewCard__*
      // These have actual review summary text (not blurred).
      const reviewCards = document.querySelectorAll("[class*='review-card_reviewCard']");

      for (const card of reviewCards) {
        const headline =
          card.querySelector("[class*='review-card_reviewHeadline']")?.textContent?.trim() || "";
        const summaryEl = card.querySelector("[class*='review-card_reviewSummary']");
        const summaryRaw = summaryEl?.textContent?.trim() || "";
        // Skip placeholder/blurred text that Gartner shows to non-logged-in users
        const summary = summaryRaw.includes("placeholder") ? "" : summaryRaw;

        const text = summary || headline;
        if (!text || text.length < 10) continue;
        if (seenTexts.has(text)) continue;
        seenTexts.add(text);

        const role =
          card.querySelector("[class*='review-card_reviewerRole']")?.textContent?.trim() || "";
        const industry =
          card.querySelector("[class*='review-card_reviewerIndustry']")?.textContent?.trim() || "";

        // Review cards don't have explicit favorable/critical labels.
        // Use rating to infer: >= 4.0 = like, < 4.0 = dislike
        const ratingText =
          card.querySelector("[class*='review-card_ratingRow']")?.textContent?.trim() || "";
        const ratingMatch = ratingText.match(/^(\d+(?:\.\d+)?)/);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
        const type: "like" | "dislike" =
          rating !== null && rating < 4.0 ? "dislike" : "like";

        results.push({
          type,
          text,
          reviewUrl: baseUrl,
          reviewerRole: role,
          reviewerIndustry: industry,
        });
      }

      return results;
    }, gartnerUrl);

    if (domInsights.length > 0) {
      const likes = domInsights.filter((r) => r.type === "like").length;
      const dislikes = domInsights.filter((r) => r.type === "dislike").length;
      console.log(`[Gartner] Extracted ${likes} likes, ${dislikes} dislikes from DOM`);
      return domInsights;
    }

    console.warn("[Gartner] Could not extract insights from page");
    return [];
  } catch (e) {
    console.error("[Gartner] Playwright scrape failed:", e instanceof Error ? e.message : e);
    return [];
  } finally {
    await browser.close();
  }
}

/** Extract insights from __NEXT_DATA__ vendor-snippets (best data source). */
function extractFromNextData(
  snippets: {
    favorable?: Array<{
      reviewId: number;
      jobTitle?: string;
      function?: string;
      answers?: {
        "lessonslearned-like-most"?: string;
        "lessonslearned-dislike-most"?: string;
      };
    }>;
    critical?: Array<{
      reviewId: number;
      jobTitle?: string;
      function?: string;
      answers?: {
        "lessonslearned-like-most"?: string;
        "lessonslearned-dislike-most"?: string;
      };
    }>;
  },
  gartnerUrl: string
): GartnerInsight[] {
  const results: GartnerInsight[] = [];

  for (const review of (snippets.favorable ?? []).slice(0, 5)) {
    const text = review.answers?.["lessonslearned-like-most"]?.trim();
    if (text) {
      results.push({
        type: "like",
        text,
        reviewUrl: `${gartnerUrl}#review-${review.reviewId}`,
        reviewerRole: review.jobTitle ?? "",
        reviewerIndustry: review.function ?? "",
      });
    }
  }

  for (const review of (snippets.critical ?? []).slice(0, 5)) {
    const text = review.answers?.["lessonslearned-dislike-most"]?.trim();
    if (text) {
      results.push({
        type: "dislike",
        text,
        reviewUrl: `${gartnerUrl}#review-${review.reviewId}`,
        reviewerRole: review.jobTitle ?? "",
        reviewerIndustry: review.function ?? "",
      });
    }
  }

  const likes = results.filter((r) => r.type === "like").length;
  const dislikes = results.filter((r) => r.type === "dislike").length;
  console.log(`[Gartner] Extracted ${likes} likes, ${dislikes} dislikes`);
  return results;
}
