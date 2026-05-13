/**
 * Local LinkedIn post-engager scraper using Playwright. Reuses the persistent
 * Chrome profile from posts-scraper.ts (no new login).
 *
 * For each post URN given, visits the post detail page and extracts:
 *   - inline comments (name + profile url + headline + comment text)
 *   - reactions list (via modal — name + profile url + headline)
 *   - reposts list (via modal — name + profile url + headline)
 *
 * Each engagement type is wrapped in try/catch independently, so one failed
 * modal doesn't kill the whole post.
 */
import { launchPersistentLinkedIn } from "./posts-scraper";

export interface RawEngagement {
  urn: string;
  engagerName: string;
  engagerLinkedinUrl: string;
  engagerHeadline?: string;
  engagementType: "like" | "comment" | "repost";
  commentText?: string;
  engagedAt?: string | null;
}

export interface EngagerScrapeResult {
  data: RawEngagement[];
  runId: string;
}

const HEADLESS = !process.env.PLAYWRIGHT_HEADFUL;
const PER_POST_TIMEOUT_MS = 45_000;

/**
 * Scrape engagers for the given post URNs (sequentially, one post at a time).
 * urns is an array of `urn:li:activity:<id>` strings.
 */
export async function scrapeEngagers(
  urns: string[],
  opts: { maxLikesPerPost?: number } = {},
): Promise<EngagerScrapeResult> {
  const maxLikes = opts.maxLikesPerPost ?? 200;
  const ctx = await launchPersistentLinkedIn({ headless: HEADLESS });
  const all: RawEngagement[] = [];

  try {
    for (const urn of urns) {
      const page = await ctx.newPage();
      const url = `https://www.linkedin.com/feed/update/${urn}/`;
      console.log(`[LI:engagers] ${urn}`);

      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: PER_POST_TIMEOUT_MS,
        });

        if (
          page.url().includes("/login") ||
          page.url().includes("/checkpoint") ||
          page.url().includes("/uas/")
        ) {
          throw new Error(
            `auth bounced to ${page.url()} — re-run scripts/setup-linkedin-session.ts`,
          );
        }

        await page.waitForTimeout(2500);

        // ── 1. inline comments ────────────────────────────────────────────
        try {
          const comments = await extractComments(page, urn);
          if (comments.length) console.log(`  comments: ${comments.length}`);
          all.push(...comments);
        } catch (e) {
          console.warn(
            `  comments failed:`,
            e instanceof Error ? e.message : e,
          );
        }

        // ── 2. reactions modal ────────────────────────────────────────────
        try {
          const reactions = await extractReactions(page, urn, maxLikes);
          if (reactions.length) console.log(`  reactions: ${reactions.length}`);
          all.push(...reactions);
        } catch (e) {
          console.warn(
            `  reactions failed:`,
            e instanceof Error ? e.message : e,
          );
        }

        // ── 3. reposts modal ──────────────────────────────────────────────
        try {
          const reposts = await extractReposts(page, urn);
          if (reposts.length) console.log(`  reposts: ${reposts.length}`);
          all.push(...reposts);
        } catch (e) {
          console.warn(`  reposts failed:`, e instanceof Error ? e.message : e);
        }
      } catch (e) {
        console.error(
          `[LI:engagers] ${urn} failed:`,
          e instanceof Error ? e.message : e,
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await ctx.close();
  }

  return { data: all, runId: `local-engagers-${Date.now()}` };
}

// ── Extractors (run inside page.evaluate — __name shim is on context) ────────

async function extractComments(
  page: import("playwright-core").Page,
  urn: string,
): Promise<RawEngagement[]> {
  // Wait briefly for the comment list to appear, but tolerate posts with no comments.
  await page
    .waitForSelector(
      "article.comments-comment-entity, .comments-comment-item",
      { timeout: 6_000 },
    )
    .catch(() => {});

  const rows = await page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const cards = Array.from(
      document.querySelectorAll(
        "article.comments-comment-entity, .comments-comment-item",
      ),
    );
    for (const c of cards) {
      const nameEl = c.querySelector(
        ".comments-post-meta__name-text, .comments-comment-meta__description, a[data-test-app-aware-link] span[aria-hidden='true']",
      );
      const linkEl = c.querySelector(
        "a.comments-post-meta__actor-link, a[data-test-app-aware-link][href*='/in/']",
      );
      const headlineEl = c.querySelector(
        ".comments-post-meta__headline, .comments-comment-meta__description-container",
      );
      const textEl = c.querySelector(
        ".comments-comment-item__main-content, .update-components-text",
      );
      const timeEl = c.querySelector("time");
      const name =
        (nameEl as HTMLElement | null)?.innerText?.trim().split("\n")[0] ?? "";
      let href = (linkEl as HTMLAnchorElement | null)?.href ?? "";
      if (href.includes("?")) href = href.split("?")[0];
      const headline =
        (headlineEl as HTMLElement | null)?.innerText?.trim().split("\n")[0] ??
        "";
      const text = (textEl as HTMLElement | null)?.innerText?.trim() ?? "";
      const dateAttr =
        timeEl?.getAttribute("datetime") ?? timeEl?.getAttribute("title") ?? null;
      if (!name) continue;
      out.push({
        engagerName: name,
        engagerLinkedinUrl: href,
        engagerHeadline: headline,
        commentText: text,
        engagedAt: dateAttr,
      });
    }
    return out;
  });

  return rows.map((r) => ({
    urn,
    engagerName: r.engagerName as string,
    engagerLinkedinUrl: r.engagerLinkedinUrl as string,
    engagerHeadline: (r.engagerHeadline as string) || undefined,
    engagementType: "comment" as const,
    commentText: (r.commentText as string) || undefined,
    engagedAt: (r.engagedAt as string | null) ?? undefined,
  }));
}

async function extractReactions(
  page: import("playwright-core").Page,
  urn: string,
  maxLikes: number,
): Promise<RawEngagement[]> {
  // Find the reactions trigger — the small "47" button next to the heart icon
  // under the post body. LinkedIn renames this often; try multiple selectors.
  const trigger = page
    .locator(
      "button.social-details-social-counts__reactions-count, button[data-reaction-details], button[aria-label*='reaction' i]",
    )
    .first();
  if (!(await trigger.count())) return [];

  await trigger.click({ timeout: 5_000 }).catch(() => {});
  // Wait for the modal to appear
  const modal = page.locator("div[role='dialog'], .artdeco-modal").first();
  await modal.waitFor({ timeout: 6_000 }).catch(() => null);
  if (!(await modal.count())) return [];

  // Scroll inside the modal a few times to lazy-load names
  for (let i = 0; i < 6; i++) {
    await page
      .evaluate(() => {
        const list = document.querySelector(
          "div[role='dialog'] .scaffold-finite-scroll__content, div[role='dialog'] ul",
        );
        if (list) (list as HTMLElement).scrollBy(0, 800);
      })
      .catch(() => {});
    await page.waitForTimeout(500);
  }

  const rows = await page.evaluate((max: number) => {
    const out: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    const root = document.querySelector("div[role='dialog']") ?? document;
    const items = Array.from(
      root.querySelectorAll(
        "li.artdeco-list__item, [data-finite-scroll-hotkey-item], a[href*='/in/']",
      ),
    );
    for (const it of items) {
      if (out.length >= max) break;
      const linkEl = (it.matches("a") ? it : it.querySelector("a[href*='/in/']")) as
        | HTMLAnchorElement
        | null;
      if (!linkEl) continue;
      let href = linkEl.href;
      if (href.includes("?")) href = href.split("?")[0];
      if (seen.has(href)) continue;
      seen.add(href);
      const card = it.closest("li") ?? it.parentElement ?? it;
      const nameEl = card.querySelector(
        "span[aria-hidden='true'], .artdeco-entity-lockup__title",
      );
      const headlineEl = card.querySelector(
        ".artdeco-entity-lockup__subtitle, .artdeco-entity-lockup__caption",
      );
      const name =
        (nameEl as HTMLElement | null)?.innerText?.trim().split("\n")[0] ?? "";
      const headline =
        (headlineEl as HTMLElement | null)?.innerText?.trim().split("\n")[0] ??
        "";
      if (!name) continue;
      out.push({
        engagerName: name,
        engagerLinkedinUrl: href,
        engagerHeadline: headline,
      });
    }
    return out;
  }, maxLikes);

  // Close modal
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  return rows.map((r) => ({
    urn,
    engagerName: r.engagerName as string,
    engagerLinkedinUrl: r.engagerLinkedinUrl as string,
    engagerHeadline: (r.engagerHeadline as string) || undefined,
    engagementType: "like" as const,
  }));
}

async function extractReposts(
  page: import("playwright-core").Page,
  urn: string,
): Promise<RawEngagement[]> {
  const trigger = page
    .locator(
      "button.social-details-social-counts__item--with-social-proof, button[aria-label*='repost' i]",
    )
    .first();
  if (!(await trigger.count())) return [];

  await trigger.click({ timeout: 5_000 }).catch(() => {});
  const modal = page.locator("div[role='dialog'], .artdeco-modal").first();
  await modal.waitFor({ timeout: 6_000 }).catch(() => null);
  if (!(await modal.count())) return [];

  for (let i = 0; i < 4; i++) {
    await page
      .evaluate(() => {
        const list = document.querySelector(
          "div[role='dialog'] .scaffold-finite-scroll__content, div[role='dialog'] ul",
        );
        if (list) (list as HTMLElement).scrollBy(0, 800);
      })
      .catch(() => {});
    await page.waitForTimeout(500);
  }

  const rows = await page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    const root = document.querySelector("div[role='dialog']") ?? document;
    const links = Array.from(root.querySelectorAll("a[href*='/in/']"));
    for (const a of links) {
      let href = (a as HTMLAnchorElement).href;
      if (href.includes("?")) href = href.split("?")[0];
      if (seen.has(href)) continue;
      seen.add(href);
      const card = a.closest("li") ?? a.parentElement ?? a;
      const nameEl = card.querySelector(
        "span[aria-hidden='true'], .artdeco-entity-lockup__title",
      );
      const headlineEl = card.querySelector(
        ".artdeco-entity-lockup__subtitle, .artdeco-entity-lockup__caption",
      );
      const name =
        (nameEl as HTMLElement | null)?.innerText?.trim().split("\n")[0] ?? "";
      const headline =
        (headlineEl as HTMLElement | null)?.innerText?.trim().split("\n")[0] ??
        "";
      if (!name) continue;
      out.push({
        engagerName: name,
        engagerLinkedinUrl: href,
        engagerHeadline: headline,
      });
    }
    return out;
  });

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  return rows.map((r) => ({
    urn,
    engagerName: r.engagerName as string,
    engagerLinkedinUrl: r.engagerLinkedinUrl as string,
    engagerHeadline: (r.engagerHeadline as string) || undefined,
    engagementType: "repost" as const,
  }));
}
