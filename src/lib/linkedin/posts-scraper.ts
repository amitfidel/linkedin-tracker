/**
 * Local LinkedIn company-posts scraper using Playwright with a persistent
 * Chrome profile. The profile lives at <project>/.playwright-data/ and is
 * established by `scripts/setup-linkedin-session.ts` (one-time manual login).
 *
 * Why a persistent profile instead of injected cookies:
 *   When you copy li_at out of your main Chrome and inject it elsewhere,
 *   LinkedIn detects the new client and invalidates the cookie ("set-cookie:
 *   li_at=delete me"). Establishing the session inside our own dedicated
 *   profile avoids this — LinkedIn sees a normal browser using its own
 *   cookies, no theft signal.
 */
import { chromium, type BrowserContext } from "playwright-core";
import { existsSync } from "fs";
import path from "path";
import type { RawPostData } from "../apify/types";

interface ScrapeResultLocal {
  data: RawPostData[];
  runId: string;
  creditsUsed: number;
}

const HEADLESS = !process.env.PLAYWRIGHT_HEADFUL;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const PER_COMPANY_TIMEOUT_MS = 60_000;
const SCROLL_ITERATIONS = 5;
const SCROLL_DELAY_MS = 1500;

export const PROFILE_DIR = path.resolve(
  process.cwd(),
  ".playwright-data",
  "linkedin",
);

/** Pull `claroty` from `https://www.linkedin.com/company/claroty/`. */
function extractCompanySlug(url: string): string | null {
  const m = /linkedin\.com\/company\/([^/?#]+)/i.exec(url);
  return m?.[1] ?? null;
}

/**
 * Launch Chrome against our persistent profile. Throws if the profile
 * directory hasn't been initialised — caller should run
 * `npx tsx scripts/setup-linkedin-session.ts` once first.
 */
export async function launchPersistentLinkedIn(opts: {
  headless?: boolean;
} = {}): Promise<BrowserContext> {
  if (!existsSync(PROFILE_DIR)) {
    throw new Error(
      `LinkedIn profile not initialised at ${PROFILE_DIR}.\n` +
        `Run: npx tsx scripts/setup-linkedin-session.ts (one-time, opens a window for you to log in).`,
    );
  }

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: opts.headless ?? HEADLESS,
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  // tsx/esbuild wraps every function expression in this file with calls to
  // a `__name(fn, "name")` helper. That helper exists in Node but not in the
  // browser context page.evaluate runs in. Inject a no-op shim into every
  // page in this context, evaluated BEFORE any other script.
  await ctx.addInitScript(() => {
    // @ts-expect-error — augment window
    if (typeof window.__name === "undefined") window.__name = (t: unknown) => t;
  });

  return ctx;
}

/**
 * Scrape recent posts for the given list of LinkedIn company URLs.
 * Companies are processed sequentially in the same browser context to
 * preserve session state across requests.
 */
export async function scrapeCompanyPostsLocal(
  companyUrls: string[],
  maxPerCompany = 20,
): Promise<ScrapeResultLocal> {
  const ctx = await launchPersistentLinkedIn();
  const allPosts: RawPostData[] = [];

  try {
    for (const url of companyUrls) {
      const slug = extractCompanySlug(url);
      if (!slug) {
        console.warn(`[LI:posts] could not extract slug from ${url}; skipping`);
        continue;
      }

      const page = await ctx.newPage();
      try {
        const postsUrl = `https://www.linkedin.com/company/${slug}/posts/`;
        console.log(`[LI:posts] ${slug} → ${postsUrl}`);

        await page.goto(postsUrl, {
          waitUntil: "domcontentloaded",
          timeout: PER_COMPANY_TIMEOUT_MS,
        });

        if (
          page.url().includes("/login") ||
          page.url().includes("/checkpoint") ||
          page.url().includes("/uas/")
        ) {
          throw new Error(
            `auth bounced to ${page.url()} — LinkedIn session in profile expired. ` +
              `Re-run: npx tsx scripts/setup-linkedin-session.ts`,
          );
        }

        await page
          .waitForSelector(
            '[data-urn^="urn:li:activity:"], [data-id^="urn:li:activity:"], div.feed-shared-update-v2',
            { timeout: 15_000 },
          )
          .catch(() => {
            console.warn(`[LI:posts] ${slug}: no post container appeared in 15s`);
          });

        for (let i = 0; i < SCROLL_ITERATIONS; i++) {
          await page.evaluate(() => window.scrollBy(0, 1800));
          await page.waitForTimeout(SCROLL_DELAY_MS);
        }

        const posts = await extractPostsFromPage(page, url, maxPerCompany);
        console.log(`[LI:posts] ${slug}: extracted ${posts.length}`);
        allPosts.push(...posts);
      } catch (e) {
        console.error(
          `[LI:posts] ${slug} failed:`,
          e instanceof Error ? e.message : e,
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await ctx.close();
  }

  return {
    data: allPosts,
    runId: `local-li-${Date.now()}`,
    creditsUsed: 0,
  };
}

/** DOM extraction — runs inside the browser via page.evaluate. */
async function extractPostsFromPage(
  page: import("playwright-core").Page,
  authorUrl: string,
  maxPerCompany: number,
): Promise<RawPostData[]> {
  // The __name shim is installed by launchPersistentLinkedIn via context-level
  // addInitScript, so it's already on window by the time evaluate body runs.
  const raw = await page.evaluate((max: number) => {
    const parseEngagementCount = (text: string | null | undefined): number => {
      if (!text) return 0;
      const cleaned = text.replace(/,/g, "").trim();
      const m = /^([\d.]+)\s*([KkMm])?/.exec(cleaned);
      if (!m) return 0;
      let n = parseFloat(m[1]);
      if (!isFinite(n)) return 0;
      const suffix = (m[2] || "").toLowerCase();
      if (suffix === "k") n *= 1000;
      else if (suffix === "m") n *= 1_000_000;
      return Math.round(n);
    };

    const deriveActorName = (card: Element): string => {
      const sel = [
        ".update-components-actor__title span[aria-hidden='true']",
        ".update-components-actor__name span[aria-hidden='true']",
        ".update-components-actor__title",
        ".feed-shared-actor__name",
      ];
      for (const s of sel) {
        const el = card.querySelector(s);
        const t = el?.textContent?.trim();
        if (t) return t.split("\n")[0].trim();
      }
      return "";
    };

    const deriveContentType = (card: Element): string => {
      if (card.querySelector("video, .feed-shared-linkedin-video")) return "video";
      if (card.querySelector(".feed-shared-article")) return "article";
      if (card.querySelector(".feed-shared-image img, .update-components-image img")) {
        return "image";
      }
      return "text";
    };

    const decodeUrnTimestamp = (urn: string): string | null => {
      const idStr = urn.split(":").pop();
      if (!idStr || !/^\d+$/.test(idStr)) return null;
      try {
        const id = BigInt(idStr);
        const ms = Number(id >> BigInt(22));
        const lower = Date.UTC(2018, 0, 1);
        const upper = Date.UTC(2030, 0, 1);
        if (ms < lower || ms > upper) return null;
        return new Date(ms).toISOString();
      } catch {
        return null;
      }
    };

    const cards = Array.from(
      document.querySelectorAll(
        '[data-urn^="urn:li:activity:"], [data-id^="urn:li:activity:"], div.feed-shared-update-v2',
      ),
    );
    const seen = new Set<string>();
    const out: Array<Record<string, unknown>> = [];

    for (const card of cards) {
      if (out.length >= max) break;
      const urn =
        card.getAttribute("data-urn") ??
        card.getAttribute("data-id") ??
        "";
      if (!urn || !urn.startsWith("urn:li:activity:")) continue;
      if (seen.has(urn)) continue;
      seen.add(urn);

      const textEl = card.querySelector(
        ".update-components-text, .feed-shared-text, .feed-shared-update-v2__description",
      );
      const text = (textEl as HTMLElement | null)?.innerText?.trim() ?? "";

      const timeEl = card.querySelector("time");
      const dateAttr =
        timeEl?.getAttribute("datetime") ??
        timeEl?.getAttribute("title") ??
        null;
      const date = dateAttr ?? decodeUrnTimestamp(urn);

      const likesEl = card.querySelector(
        ".social-details-social-counts__reactions-count, [data-test-id='social-actions-reactions-count']",
      );
      const likes = parseEngagementCount(
        (likesEl as HTMLElement | null)?.innerText,
      );

      const commentsEl = card.querySelector(
        ".social-details-social-counts__comments, button[aria-label*='comment' i]",
      );
      const comments = parseEngagementCount(
        (commentsEl as HTMLElement | null)?.innerText?.match(/[\d.]+[KkMm]?/)?.[0] ?? "",
      );

      const sharesEl = card.querySelector(
        ".social-details-social-counts__item--with-social-proof, button[aria-label*='repost' i]",
      );
      const shares = parseEngagementCount(
        (sharesEl as HTMLElement | null)?.innerText?.match(/[\d.]+[KkMm]?/)?.[0] ?? "",
      );

      out.push({
        url: `https://www.linkedin.com/feed/update/${urn}/`,
        text,
        date,
        author: deriveActorName(card),
        likes,
        comments_count: comments,
        shares_count: shares,
        content_type: deriveContentType(card),
        urn,
      });
    }

    return out;
  }, maxPerCompany);

  return raw.map((r) => ({
    ...r,
    author_url: authorUrl,
  })) as RawPostData[];
}
