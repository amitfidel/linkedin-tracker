/**
 * Try to auto-discover a company's Gartner Peer Insights likes-dislikes URL.
 *
 * Strategy: search DuckDuckGo HTML (no JS rendering needed — direct hrefs)
 * for "site:gartner.com/reviews {name} likes-dislikes" and extract the first
 * matching /reviews/market/{market}/vendor/{vendor}[/product/{p}]/likes-dislikes URL.
 *
 * Falls back to any /reviews/market/{market}/vendor/{vendor} URL if no
 * likes-dislikes page is found directly, appending /likes-dislikes to it.
 *
 * Returns null if not found or if ScraperAPI is unavailable.
 */
export async function discoverGartnerUrl(companyName: string): Promise<string | null> {
  const scraperApiKey = process.env.SCRAPER_API_KEY;
  if (!scraperApiKey) {
    console.log("[Gartner:discover] SCRAPER_API_KEY not set — skipping auto-discovery");
    return null;
  }

  // DuckDuckGo HTML endpoint — returns plain HTML with direct href links, no JS required
  const query = `site:gartner.com/reviews ${companyName} likes-dislikes`;
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const proxied = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(searchUrl)}&render=false`;

  console.log(`[Gartner:discover] DDG-searching Gartner for: ${companyName}`);

  try {
    const res = await fetch(proxied, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.warn(`[Gartner:discover] DDG search returned HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();

    // ── Priority 1: exact likes-dislikes page ───────────────────────────────
    // Matches: gartner.com/reviews/market/{mkt}/vendor/{v}[/product/{p}]/likes-dislikes
    const likesDislikes =
      /(?:https?:)?\/\/(?:www\.)?gartner\.com(\/reviews\/market\/[a-z0-9-]+\/vendor\/[a-z0-9-]+(?:\/product\/[a-z0-9-]+)?\/likes-dislikes)/gi;
    const ldMatch = likesDislikes.exec(html);
    if (ldMatch) {
      const url = `https://www.gartner.com${ldMatch[1]}`;
      console.log(`[Gartner:discover] Found likes-dislikes URL for ${companyName}: ${url}`);
      return url;
    }

    // ── Priority 2: vendor page (append /likes-dislikes) ────────────────────
    // Matches: gartner.com/reviews/market/{mkt}/vendor/{v}  (no product path)
    const vendorPage =
      /(?:https?:)?\/\/(?:www\.)?gartner\.com(\/reviews\/market\/[a-z0-9-]+\/vendor\/[a-z0-9-]+)(?=[^a-z0-9/-]|\/(?!product)[^a-z]|$)/gi;
    const vpMatch = vendorPage.exec(html);
    if (vpMatch) {
      const url = `https://www.gartner.com${vpMatch[1]}/likes-dislikes`;
      console.log(`[Gartner:discover] Derived likes-dislikes URL for ${companyName}: ${url}`);
      return url;
    }

    console.log(`[Gartner:discover] No Gartner URL found for ${companyName}`);
    return null;
  } catch (e) {
    console.warn("[Gartner:discover] Failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

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
 * Scrape Gartner Peer Insights likes/dislikes.
 *
 * Strategy:
 *   Step 1 – Fetch the HTML page via ScraperAPI (bypasses Cloudflare).
 *            Extract the Next.js buildId from script src attributes.
 *   Step 2 – Fetch the /_next/data/<buildId>/…likes-dislikes.json endpoint
 *            via ScraperAPI. This is the lightweight JSON route Next.js uses
 *            for client-side navigation; it returns the same serverSideXHRData
 *            as __NEXT_DATA__ but without requiring a full HTML render.
 *            Gartner serves this endpoint publicly — no login cookie needed.
 *
 * Data source: pageProps.serverSideXHRData['vendor-snippets']
 *   - favorable: top positive reviews → likes
 *   - critical:  top critical reviews → dislikes
 *
 * reviewId is used as the stable dedup key.
 */
export async function scrapeGartnerInsights(
  gartnerUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _existingReviewUrls: Set<string> = new Set()
): Promise<GartnerInsight[]> {
  console.log("[Gartner] Fetching:", gartnerUrl);

  const scraperApiKey = process.env.SCRAPER_API_KEY;

  const makeUrl = (target: string) =>
    scraperApiKey
      ? `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(target)}&render=false`
      : target;

  if (!scraperApiKey) {
    console.warn("[Gartner] SCRAPER_API_KEY not set — direct fetch may fail on Railway (Cloudflare blocks)");
  }

  // ── Step 1: fetch the HTML page to extract the Next.js buildId ─────────────
  let buildId: string | null = null;
  let snippetsFromHtml: VendorSnippets | null = null;

  try {
    const res = await fetch(makeUrl(gartnerUrl), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.warn(`[Gartner] HTML fetch HTTP ${res.status}`);
    } else {
      const html = await res.text();
      console.log("[Gartner] HTML preview:", html.slice(0, 300).replace(/\s+/g, " "));

      // Try __NEXT_DATA__ first (present when authenticated SSR works)
      const nextDataMatch = html.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
      );
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          buildId = nextData?.buildId ?? null;
          const s = nextData?.props?.pageProps?.serverSideXHRData?.["vendor-snippets"];
          if (s?.favorable || s?.critical) {
            snippetsFromHtml = s;
            console.log("[Gartner] Got snippets from __NEXT_DATA__ directly");
          }
        } catch {
          // ignore parse error
        }
      }

      // Extract buildId from script src if not found in __NEXT_DATA__
      if (!buildId) {
        const buildIdMatch = html.match(/\/_next\/static\/([a-f0-9]{40})\//);
        if (buildIdMatch) {
          buildId = buildIdMatch[1];
          console.log("[Gartner] Extracted buildId from script src:", buildId);
        }
      }
    }
  } catch (e) {
    console.warn("[Gartner] HTML fetch failed:", e instanceof Error ? e.message : e);
  }

  // If we already got snippets from __NEXT_DATA__, use them
  if (snippetsFromHtml) {
    return extractInsights(snippetsFromHtml, gartnerUrl);
  }

  // ── Step 2: fetch the /_next/data JSON endpoint ─────────────────────────────
  if (!buildId) {
    console.warn("[Gartner] Could not determine buildId — skipping JSON endpoint");
    return [];
  }

  // Derive the page path from the URL:
  //   https://www.gartner.com/reviews/market/{market}/vendor/{vendor}/likes-dislikes
  //   → /reviews/_next/data/{buildId}/market/{market}/vendor/{vendor}/likes-dislikes.json
  const urlObj = new URL(gartnerUrl);
  // path: /reviews/market/{marketSeoName}/vendor/{vendorSeoName}/likes-dislikes
  const pagePath = urlObj.pathname.replace(/^\/reviews/, ""); // /market/.../likes-dislikes
  const jsonUrl = `${urlObj.origin}/reviews/_next/data/${buildId}${pagePath}.json`;

  console.log("[Gartner] Fetching JSON data endpoint:", jsonUrl);

  try {
    const res = await fetch(makeUrl(jsonUrl), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, */*",
        "Accept-Language": "en-US,en;q=0.9",
        // Mimic what Next.js sends for client-side navigation
        "x-nextjs-data": "1",
        Referer: gartnerUrl,
      },
    });

    if (!res.ok) {
      console.warn(`[Gartner] JSON endpoint HTTP ${res.status} for ${jsonUrl}`);
      return [];
    }

    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    console.log("[Gartner] JSON endpoint response preview:", text.slice(0, 200).replace(/\s+/g, " "));

    if (!contentType.includes("json") && !text.trim().startsWith("{")) {
      console.warn("[Gartner] JSON endpoint returned non-JSON response");
      return [];
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      console.warn("[Gartner] Failed to parse JSON endpoint response");
      return [];
    }

    const snippets =
      (data as { pageProps?: { serverSideXHRData?: { "vendor-snippets"?: VendorSnippets } } })
        ?.pageProps?.serverSideXHRData?.["vendor-snippets"];

    if (!snippets?.favorable && !snippets?.critical) {
      console.warn("[Gartner] No favorable/critical snippets in JSON response");
      return [];
    }

    return extractInsights(snippets, gartnerUrl);
  } catch (e) {
    console.warn("[Gartner] JSON endpoint fetch failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

function extractInsights(snippets: VendorSnippets, gartnerUrl: string): GartnerInsight[] {
  const results: GartnerInsight[] = [];

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
      `${results.filter((r) => r.type === "dislike").length} dislikes`
  );
  return results;
}
