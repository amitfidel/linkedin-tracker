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
 * Returns a merged array of all job results tagged with their company name.
 */
export async function scrapeJobs(companies: Array<{ name: string }>): Promise<ScrapeResult<RawJobData>> {
  const client = getApifyClient();
  const allItems: RawJobData[] = [];
  const runIds: string[] = [];
  let totalCredits = 0;

  for (const company of companies) {
    try {
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

      allItems.push(...matched);
      runIds.push(run.id);
      totalCredits += runInfo?.usageTotalUsd ?? 0;
    } catch (err) {
      // Log per-company failures but continue with the rest
      console.error(`Jobs scrape failed for ${company.name}:`, err instanceof Error ? err.message : err);
    }
  }

  return {
    data: allItems,
    runId: runIds.join(","),
    creditsUsed: totalCredits,
  };
}

/** Fetch key employees for all tracked company URLs in one batch run. */
export async function scrapePeople(
  companyUrls: string[]
): Promise<ScrapeResult<RawPersonData>> {
  return runActor<RawPersonData>(buildPeopleInput(companyUrls));
}
