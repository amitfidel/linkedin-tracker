import { getApifyClient } from "./client";
import {
  LINKEDIN_SCRAPER_ACTOR,
  buildCompanyInput,
  buildPostsInput,
  buildJobsInput,
  buildPeopleInput,
} from "./actors";
import type {
  RawCompanyData,
  RawPostData,
  RawJobData,
  RawPersonData,
} from "./types";
import { runPool } from "@/lib/utils/pool";

// Apify free tier allows 5 concurrent actor runs — stay at 3 to leave headroom.
const APIFY_MAX_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.APIFY_MAX_CONCURRENCY ?? "3", 10) || 3
);

export interface ScrapeResult<T> {
  data: T[];
  runId: string;
  creditsUsed: number;
}

async function runActor<T>(input: Record<string, unknown>): Promise<ScrapeResult<T>> {
  const client = getApifyClient();
  const run = await client.actor(LINKEDIN_SCRAPER_ACTOR).call(input, {
    waitSecs: 300, // wait up to 5 minutes
    memory: 256,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  // Fetch credit usage
  const runInfo = await client.run(run.id).get();
  const creditsUsed = runInfo?.usageTotalUsd ?? 0;

  return {
    data: items as T[],
    runId: run.id,
    creditsUsed,
  };
}

/** Fetch company info for all tracked company URLs in one batch run. */
export async function scrapeCompanies(
  companyUrls: string[]
): Promise<ScrapeResult<RawCompanyData>> {
  return runActor<RawCompanyData>(buildCompanyInput(companyUrls));
}

/** Fetch recent posts for all tracked company URLs in one batch run. */
export async function scrapePosts(
  companyUrls: string[]
): Promise<ScrapeResult<RawPostData>> {
  return runActor<RawPostData>(buildPostsInput(companyUrls));
}

/**
 * Fetch job listings for each company separately.
 * Jobs mode requires a keyword searchQuery — one run per company.
 * Runs up to APIFY_MAX_CONCURRENCY actor runs in parallel (default: 3).
 * Returns a merged array of all job results tagged with their company name.
 */
export async function scrapeJobs(
  companies: Array<{ name: string }>
): Promise<ScrapeResult<RawJobData> & { perCompanyErrors: string[] }> {
  const client = getApifyClient();

  const results = await runPool(
    companies,
    async (company) => {
      const run = await client.actor(LINKEDIN_SCRAPER_ACTOR).call(
        buildJobsInput(company.name),
        { waitSecs: 120, memory: 256 }
      );
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      const runInfo = await client.run(run.id).get();

      // Only keep jobs where the posting company matches our tracked company
      const normalized = company.name.toLowerCase();
      const matched = (items as RawJobData[]).filter((job) => {
        const jobCompany = (job.company ?? "").toLowerCase();
        return jobCompany.includes(normalized) || normalized.includes(jobCompany);
      });

      return {
        items: matched,
        runId: run.id,
        credits: runInfo?.usageTotalUsd ?? 0,
      };
    },
    APIFY_MAX_CONCURRENCY
  );

  const allItems: RawJobData[] = [];
  const runIds: string[] = [];
  let totalCredits = 0;
  const perCompanyErrors: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = companies[i].name;
    if (r.status === "fulfilled") {
      allItems.push(...r.value.items);
      runIds.push(r.value.runId);
      totalCredits += r.value.credits;
    } else {
      const msg = `Jobs scrape failed for ${name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
      console.error(msg);
      perCompanyErrors.push(msg);
    }
  }

  return {
    data: allItems,
    runId: runIds.join(","),
    creditsUsed: totalCredits,
    perCompanyErrors,
  };
}

/** Fetch key employees for all tracked company URLs in one batch run. */
export async function scrapePeople(
  companyUrls: string[]
): Promise<ScrapeResult<RawPersonData>> {
  return runActor<RawPersonData>(buildPeopleInput(companyUrls));
}
