export interface GartnerInsight {
  type: "like" | "dislike";
  text: string;
  reviewUrl: string;
  reviewerRole?: string;
  reviewerIndustry?: string;
}

interface GartnerReview {
  reviewId: number;
  jobTitle?: string;
  function?: string;
  answers?: {
    "lessonslearned-like-most"?: string;
    "lessonslearned-dislike-most"?: string;
  };
}

interface VendorSnippets {
  favorable?: GartnerReview[];
  critical?: GartnerReview[];
}

/**
 * Scrape Gartner Peer Insights likes/dislikes by fetching the HTML directly
 * and parsing the __NEXT_DATA__ JSON embedded in the page — no browser needed.
 *
 * The likes/dislikes page is publicly accessible (isLoggedIn: false confirmed).
 * Gartner embeds all review data server-side in __NEXT_DATA__ before the page loads.
 *
 * Data source: serverSideXHRData['vendor-snippets']
 *   - favorable: top positive reviews → we extract their likes
 *   - critical:  top critical reviews → we extract their dislikes
 *
 * reviewId is used as the stable dedup key.
 */
export async function scrapeGartnerInsights(
  gartnerUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _existingReviewUrls: Set<string> = new Set()
): Promise<GartnerInsight[]> {
  console.log("[Gartner] Fetching:", gartnerUrl);

  // Cloudflare blocks Railway datacenter IPs directly.
  // Route through ScraperAPI (free tier: 1000 calls/month — we use ~8/month).
  // Get a free key at https://www.scraperapi.com/
  const scraperApiKey = process.env.SCRAPER_API_KEY;
  const fetchUrl = scraperApiKey
    ? `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(gartnerUrl)}&render=false`
    : gartnerUrl; // fallback for local dev (no Cloudflare block locally)

  if (!scraperApiKey) {
    console.warn("[Gartner] SCRAPER_API_KEY not set — direct fetch may get 403 from Cloudflare");
  }

  let html: string;
  try {
    const res = await fetch(fetchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.warn(`[Gartner] HTTP ${res.status} for ${gartnerUrl}`);
      return [];
    }
    html = await res.text();
  } catch (e) {
    console.warn("[Gartner] Fetch failed:", e instanceof Error ? e.message : e);
    return [];
  }

  // Extract the __NEXT_DATA__ JSON embedded by Next.js SSR
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) {
    console.warn("[Gartner] __NEXT_DATA__ not found in page HTML");
    return [];
  }

  let snippets: VendorSnippets;
  try {
    const nextData = JSON.parse(match[1]);
    snippets =
      nextData?.props?.pageProps?.serverSideXHRData?.["vendor-snippets"] ?? {};
  } catch (e) {
    console.warn("[Gartner] Failed to parse __NEXT_DATA__:", e instanceof Error ? e.message : e);
    return [];
  }

  if (!snippets.favorable && !snippets.critical) {
    console.warn("[Gartner] No favorable/critical snippets found in page data");
    return [];
  }

  const results: GartnerInsight[] = [];

  // Top 3 likes from the most favorable (high-rated) reviews
  for (const review of (snippets.favorable ?? []).slice(0, 3)) {
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

  // Top 3 dislikes from the most critical (low-rated) reviews
  for (const review of (snippets.critical ?? []).slice(0, 3)) {
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

  console.log(
    `[Gartner] Extracted ${results.filter((r) => r.type === "like").length} likes, ` +
    `${results.filter((r) => r.type === "dislike").length} dislikes from ${gartnerUrl}`
  );

  return results;
}
