/**
 * Local Playwright employee-roster scraper using the persistent Chrome
 * profile that posts-scraper.ts and engagers-scraper.ts already use.
 *
 * Replaces the Apify `company_employees` mode, which is degraded for the
 * public `get-leads/linkedin-scraper` actor (it can't accept cookies in
 * input and its SERP fallback is rate-limited on Brave). Going through
 * your logged-in profile means we hit LinkedIn's real People tab.
 *
 * Per company:
 *   1. Navigate to https://www.linkedin.com/company/<slug>/people/
 *   2. Scroll a few times to lazy-load more employee cards
 *   3. Extract name + headline + profile URL from each card
 *   4. Return {company, name, headline, profileUrl}[] shaped like the
 *      orchestrator's existing RawPersonData expectations.
 */
import { launchPersistentLinkedIn } from "./posts-scraper";
import type { RawPersonData } from "../apify/types";

interface ScrapeResultLocal {
  data: RawPersonData[];
  runId: string;
}

const HEADLESS = !process.env.PLAYWRIGHT_HEADFUL;
const PER_COMPANY_TIMEOUT_MS = 60_000;
const SCROLL_ITERATIONS = 6;
const SCROLL_DELAY_MS = 1500;
const INTER_COMPANY_DELAY_MS = 2500;
const MAX_PEOPLE_PER_COMPANY = 30;

function extractCompanySlug(url: string): string | null {
  const m = /linkedin\.com\/company\/([^/?#]+)/i.exec(url);
  return m?.[1] ?? null;
}

/**
 * Scrape employee rosters for the given company URLs sequentially.
 * Returns rows shaped like Apify's RawPersonData so the orchestrator's
 * existing transformPerson + findByName matcher can ingest them unchanged.
 */
export async function scrapeCompanyEmployeesLocal(
  companyUrls: Array<{ url: string; name: string }>,
): Promise<ScrapeResultLocal> {
  const ctx = await launchPersistentLinkedIn({ headless: HEADLESS });
  const all: RawPersonData[] = [];

  try {
    for (let i = 0; i < companyUrls.length; i++) {
      const { url, name } = companyUrls[i];
      const slug = extractCompanySlug(url);
      if (!slug) {
        console.warn(`[LI:employees] no slug for ${url} — skipping`);
        continue;
      }

      const page = await ctx.newPage();
      const peopleUrl = `https://www.linkedin.com/company/${slug}/people/`;
      console.log(
        `[LI:employees] ${i + 1}/${companyUrls.length} ${name} → ${peopleUrl}`,
      );

      try {
        await page.goto(peopleUrl, {
          waitUntil: "domcontentloaded",
          timeout: PER_COMPANY_TIMEOUT_MS,
        });

        if (
          page.url().includes("/login") ||
          page.url().includes("/checkpoint") ||
          page.url().includes("/uas/")
        ) {
          throw new Error(
            `auth bounced to ${page.url()} — session expired; re-run scripts/setup-linkedin-session.ts`,
          );
        }

        await page
          .waitForSelector(
            'a[href*="/in/"], .org-people-profile-card, .artdeco-entity-lockup',
            { timeout: 12_000 },
          )
          .catch(() => {});

        for (let s = 0; s < SCROLL_ITERATIONS; s++) {
          await page.evaluate(() => window.scrollBy(0, 1500));
          await page.waitForTimeout(SCROLL_DELAY_MS);
        }

        const rows = await extractEmployees(page);
        console.log(`  → ${rows.length} employees`);
        for (const r of rows) {
          all.push({
            name: r.name,
            url: r.profileUrl,
            headline: r.headline,
            company: name,
          });
        }
      } catch (e) {
        console.error(
          `[LI:employees] ${slug} failed:`,
          e instanceof Error ? e.message : e,
        );
      } finally {
        await page.close();
      }

      // Brief pause between companies to avoid pattern-detection
      if (i + 1 < companyUrls.length) {
        await new Promise((r) => setTimeout(r, INTER_COMPANY_DELAY_MS));
      }
    }
  } finally {
    await ctx.close();
  }

  return { data: all, runId: `local-employees-${Date.now()}` };
}

async function extractEmployees(
  page: import("playwright-core").Page,
): Promise<Array<{ name: string; headline: string; profileUrl: string }>> {
  const rows = await page.evaluate((max: number) => {
    const out: Array<Record<string, string>> = [];
    const seen = new Set<string>();

    // LinkedIn's People tab uses an entity-lockup card for each employee.
    // Match multiple selector variants because LinkedIn renames classes.
    const cards = Array.from(
      document.querySelectorAll(
        ".org-people-profile-card, .artdeco-entity-lockup, li.org-people-profile-card__profile-card-spacing",
      ),
    );

    const sources: Element[] =
      cards.length > 0
        ? cards
        : Array.from(document.querySelectorAll("a[href*='/in/']")).map(
            (a) => a.closest("li, div") ?? a,
          );

    for (const card of sources) {
      if (out.length >= max) break;

      const linkEl = (
        card.tagName === "A"
          ? (card as HTMLAnchorElement)
          : card.querySelector('a[href*="/in/"]')
      ) as HTMLAnchorElement | null;
      if (!linkEl) continue;

      let href = linkEl.href;
      if (href.includes("?")) href = href.split("?")[0];
      if (!/\/in\//.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);

      // Name — first non-empty visible span inside the lockup-title block
      const nameEl =
        card.querySelector(".artdeco-entity-lockup__title span[aria-hidden='true']") ||
        card.querySelector(".artdeco-entity-lockup__title") ||
        card.querySelector(".org-people-profile-card__profile-title");
      const name =
        (nameEl as HTMLElement | null)?.innerText
          ?.trim()
          .split("\n")[0] ?? "";
      if (!name || /^[A-Z]\.\s*[A-Z]/.test(name) === false && name.length < 2)
        continue;

      const headlineEl =
        card.querySelector(".artdeco-entity-lockup__subtitle") ||
        card.querySelector(".lt-line-clamp__line") ||
        card.querySelector(".org-people-profile-card__profile-subtitle");
      const headline =
        (headlineEl as HTMLElement | null)?.innerText?.trim().split("\n")[0] ??
        "";

      out.push({ name, headline, profileUrl: href });
    }

    return out;
  }, MAX_PEOPLE_PER_COMPANY);
  return rows as Array<{ name: string; headline: string; profileUrl: string }>;
}
