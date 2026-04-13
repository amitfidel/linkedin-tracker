import { chromium } from "playwright-core";

export interface GartnerInsight {
  type: "like" | "dislike";
  text: string;
  reviewUrl: string;
  reviewerRole?: string;
  reviewerIndustry?: string;
}

const HEADLESS = !process.env.PLAYWRIGHT_HEADFUL;

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Returns null on Railway (no Chrome available). */
async function launchBrowser() {
  // On Railway / production, skip browser launch entirely — no Chrome available.
  // Railway sets RAILWAY_ENVIRONMENT_NAME, RAILWAY_PROJECT_ID, etc.
  const isRailway = !!(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
  if (isRailway) {
    return null;
  }

  try {
    return await chromium.launch({ channel: "chrome", headless: HEADLESS });
  } catch {
    return null;
  }
}

/**
 * Auto-discover a company's Gartner Peer Insights likes-dislikes URL.
 *
 * Uses Playwright + DuckDuckGo to find the URL without any paid proxy.
 * Only works in headful mode (DDG shows CAPTCHA in headless).
 * This is a one-time operation — the URL gets saved to the DB.
 */
export async function discoverGartnerUrl(
  companyName: string
): Promise<string | null> {
  console.log(`[Gartner:discover] Searching for Gartner URL: ${companyName}`);

  const browser = await launchBrowser();
  if (!browser) {
    console.log("[Gartner:discover] No browser available — skipping discovery");
    return null;
  }

  try {
    const page = await browser.newPage();

    const query = `site:gartner.com/reviews ${companyName} likes-dislikes`;

    await page.goto(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 }
    );

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

    // Priority 1: URL with /likes-dislikes
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

    // Priority 2: vendor/product page — append /likes-dislikes
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

// ── Vendor-snippets type used by both fetch and Playwright strategies ────────

interface VendorSnippets {
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
}

/**
 * Scrape Gartner Peer Insights likes/dislikes.
 *
 * Two strategies tried in order:
 *   1. Fetch-based: plain HTTP fetch → extract __NEXT_DATA__ or buildId JSON.
 *      Works on Railway (no browser needed). May fail if Cloudflare blocks.
 *   2. Playwright-based: launch Chrome, render page, extract from DOM.
 *      Works locally. Falls back here if fetch fails.
 */
export async function scrapeGartnerInsights(
  gartnerUrl: string,
  _existingReviewUrls: Set<string> = new Set()
): Promise<GartnerInsight[]> {
  // Strategy 1: fetch-based (works on Railway, no browser needed)
  const fetchResult = await scrapeViaFetch(gartnerUrl);
  if (fetchResult.length > 0) return fetchResult;

  // Strategy 2: Playwright-based (works locally with Chrome)
  return scrapeViaPlaywright(gartnerUrl);
}

// ── Strategy 1: Fetch-based (no browser) ────────────────────────────────────

async function scrapeViaFetch(gartnerUrl: string): Promise<GartnerInsight[]> {
  console.log("[Gartner:fetch] Trying fetch-based scrape:", gartnerUrl);

  try {
    const res = await fetch(gartnerUrl, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.log(`[Gartner:fetch] HTTP ${res.status} — will try Playwright`);
      return [];
    }

    const html = await res.text();

    // Try __NEXT_DATA__ from the HTML
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const snippets = data?.props?.pageProps?.serverSideXHRData?.["vendor-snippets"] as VendorSnippets | undefined;
        if (snippets?.favorable || snippets?.critical) {
          console.log("[Gartner:fetch] Got snippets from __NEXT_DATA__");
          return extractFromNextData(snippets, gartnerUrl);
        }
        // If __NEXT_DATA__ exists but no snippets, try the buildId JSON endpoint
        const buildId = data?.buildId as string | undefined;
        if (buildId) {
          const result = await fetchBuildIdJson(gartnerUrl, buildId);
          if (result.length > 0) return result;
        }
      } catch {
        // parse error — continue
      }
    }

    // Try extracting buildId from script src attributes
    const buildIdMatch = html.match(/\/_next\/static\/([a-f0-9]{20,})\//);
    if (buildIdMatch) {
      const result = await fetchBuildIdJson(gartnerUrl, buildIdMatch[1]);
      if (result.length > 0) return result;
    }

    console.log("[Gartner:fetch] No data extracted via fetch");
    return [];
  } catch (e) {
    console.log("[Gartner:fetch] Fetch failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

async function fetchBuildIdJson(gartnerUrl: string, buildId: string): Promise<GartnerInsight[]> {
  const urlObj = new URL(gartnerUrl);
  const pagePath = urlObj.pathname.replace(/^\/reviews/, "");
  const jsonUrl = `${urlObj.origin}/reviews/_next/data/${buildId}${pagePath}.json`;

  console.log("[Gartner:fetch] Trying buildId JSON:", jsonUrl);

  try {
    const res = await fetch(jsonUrl, {
      headers: { ...FETCH_HEADERS, Accept: "application/json, */*", "x-nextjs-data": "1", Referer: gartnerUrl },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return [];

    const text = await res.text();
    if (!text.trim().startsWith("{")) return [];

    const data = JSON.parse(text);
    const snippets = data?.pageProps?.serverSideXHRData?.["vendor-snippets"] as VendorSnippets | undefined;
    if (snippets?.favorable || snippets?.critical) {
      console.log("[Gartner:fetch] Got snippets from buildId JSON");
      return extractFromNextData(snippets!, gartnerUrl);
    }
  } catch {
    // continue
  }
  return [];
}

// ── Strategy 2: Playwright-based (local Chrome) ─────────────────────────────

async function scrapeViaPlaywright(gartnerUrl: string): Promise<GartnerInsight[]> {
  console.log("[Gartner:pw] Trying Playwright scrape:", gartnerUrl);

  const browser = await launchBrowser();
  if (!browser) {
    console.log("[Gartner:pw] No browser available (expected on Railway) — skipping Playwright");
    return [];
  }

  try {
    const context = await browser.newContext({
      userAgent: FETCH_HEADERS["User-Agent"],
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(gartnerUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

    await page.waitForSelector("[class*='reviewCard']", { timeout: 15_000 }).catch(() => {
      console.log("[Gartner:pw] No review cards within timeout");
    });

    // Try __NEXT_DATA__
    const nextDataInsights = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el) return null;
      try {
        const data = JSON.parse(el.textContent || "");
        const snippets = data?.props?.pageProps?.serverSideXHRData?.["vendor-snippets"];
        if (!snippets?.favorable && !snippets?.critical) return null;
        return snippets;
      } catch {
        return null;
      }
    }) as VendorSnippets | null;

    if (nextDataInsights) {
      console.log("[Gartner:pw] Extracted data from __NEXT_DATA__");
      return extractFromNextData(nextDataInsights, gartnerUrl);
    }

    // Extract from rendered DOM
    console.log("[Gartner:pw] Extracting from DOM...");

    const domInsights = await page.evaluate((baseUrl: string) => {
      const results: Array<{
        type: "like" | "dislike";
        text: string;
        reviewUrl: string;
        reviewerRole: string;
        reviewerIndustry: string;
      }> = [];
      const seenTexts = new Set<string>();

      // Panel cards (FAVORABLE/CRITICAL labels)
      const panelCards = document.querySelectorAll("[class*='overall-review-panel_reviewCard']");
      for (const card of panelCards) {
        const typeLabel = card.querySelector("[class*='reviewTypeRight']")?.textContent?.trim().toUpperCase() || "";
        const hasCriticalDot = card.querySelector("[class*='reviewTypeDot--critical']");
        const hasFavorableDot = card.querySelector("[class*='reviewTypeDot--favorable']");

        const headline = card.querySelector("[class*='reviewHeadline']")?.textContent?.trim()
          .replace(/^\u201c|\u201d$/g, "").replace(/^"|"$/g, "") || "";

        const summaryEl = card.querySelector("[class*='reviewSummary']");
        const isBlurred = summaryEl?.className?.includes("blurred") ?? true;
        const isPlaceholder = summaryEl?.textContent?.includes("placeholder") ?? false;
        const summaryText = (!isBlurred && !isPlaceholder) ? summaryEl?.textContent?.trim() : "";

        const text = summaryText || headline;
        if (!text || text.length < 5 || seenTexts.has(text)) continue;
        seenTexts.add(text);

        results.push({
          type: hasCriticalDot ? "dislike" : hasFavorableDot ? "like" : (typeLabel === "CRITICAL" ? "dislike" : "like"),
          text,
          reviewUrl: baseUrl,
          reviewerRole: card.querySelector("[class*='reviewerRole']")?.textContent?.trim() || "",
          reviewerIndustry: card.querySelector("[class*='reviewerCompanyIndustry']")?.textContent?.trim() || "",
        });
      }

      // Likes & Dislikes panel (two-column layout with aria-label="Likes"/"Dislikes")
      // This is a separate section from the review cards, with its own DOM structure.
      const ldColumns = document.querySelectorAll("[class*='likes-dislike-panel_column']");
      for (const col of ldColumns) {
        const ariaLabel = col.getAttribute("aria-label")?.toLowerCase() || "";
        const type: "like" | "dislike" = ariaLabel.includes("dislike") ? "dislike" : "like";

        const items = col.querySelectorAll("[class*='likes-dislike-panel_itemContent']");
        for (const item of items) {
          const text = item.textContent?.trim() || "";
          if (!text || text.length < 5 || seenTexts.has(text)) continue;
          seenTexts.add(text);
          results.push({ type, text, reviewUrl: baseUrl, reviewerRole: "", reviewerIndustry: "" });
        }
      }

      // Review cards (real summary text)
      const reviewCards = document.querySelectorAll("[class*='review-card_reviewCard']");
      for (const card of reviewCards) {
        const headline = card.querySelector("[class*='review-card_reviewHeadline']")?.textContent?.trim() || "";
        const summaryRaw = card.querySelector("[class*='review-card_reviewSummary']")?.textContent?.trim() || "";
        const summary = summaryRaw.includes("placeholder") ? "" : summaryRaw;

        const text = summary || headline;
        if (!text || text.length < 10 || seenTexts.has(text)) continue;
        seenTexts.add(text);

        const ratingText = card.querySelector("[class*='review-card_ratingRow']")?.textContent?.trim() || "";
        const ratingMatch = ratingText.match(/^(\d+(?:\.\d+)?)/);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

        results.push({
          type: rating !== null && rating < 4.0 ? "dislike" : "like",
          text,
          reviewUrl: baseUrl,
          reviewerRole: card.querySelector("[class*='review-card_reviewerRole']")?.textContent?.trim() || "",
          reviewerIndustry: card.querySelector("[class*='review-card_reviewerIndustry']")?.textContent?.trim() || "",
        });
      }

      return results;
    }, gartnerUrl);

    if (domInsights.length > 0) {
      const likes = domInsights.filter((r) => r.type === "like").length;
      const dislikes = domInsights.filter((r) => r.type === "dislike").length;
      console.log(`[Gartner:pw] Extracted ${likes} likes, ${dislikes} dislikes from DOM`);
      return domInsights;
    }

    console.warn("[Gartner:pw] Could not extract insights from page");
    return [];
  } catch (e) {
    console.error("[Gartner:pw] Failed:", e instanceof Error ? e.message : e);
    return [];
  } finally {
    await browser.close();
  }
}

// ── Shared: extract insights from vendor-snippets ───────────────────────────

function extractFromNextData(snippets: VendorSnippets, gartnerUrl: string): GartnerInsight[] {
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
