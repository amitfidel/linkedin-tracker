// Actor IDs and input builders for the All-in-One LinkedIn Scraper (get-leads/linkedin-scraper)
//
// Valid modes (verified against live actor):
//   "profiles" | "companies" | "jobs" | "posts" | "search" | "search_profiles"
//   "profile_complete" | "company_employees" | "monitor"
//
// NOTE: jobs mode requires `searchQuery` (keyword), not company URLs.
//       One actor run per company is needed for job scraping.

export const LINKEDIN_SCRAPER_ACTOR = "get-leads/linkedin-scraper";

/** Batch all company URLs in a single run to get company info. */
export function buildCompanyInput(companyUrls: string[]) {
  return {
    urls: companyUrls,
    mode: "companies",
    maxResults: companyUrls.length,
  };
}

/** Batch all company URLs in a single run to get recent posts.
 *  Posts mode requires a LinkedIn li_at session cookie (Voyager feed API).
 *  Set LINKEDIN_LI_AT_COOKIE in your environment variables.
 */
export function buildPostsInput(companyUrls: string[]) {
  const cookie = process.env.LINKEDIN_LI_AT_COOKIE;
  return {
    urls: companyUrls,
    mode: "posts",
    maxResults: companyUrls.length * 20, // up to 20 posts per company
    ...(cookie ? { cookie } : {}),
  };
}

/**
 * Jobs mode needs a keyword searchQuery — it does NOT accept company URLs.
 * We run one search per company using the company name, then filter by
 * the `company` field in results to get only that company's actual postings.
 */
export function buildJobsInput(companyName: string, maxResults = 50) {
  return {
    searchQuery: companyName,
    mode: "jobs",
    maxResults,
  };
}

/** Batch all company URLs in a single run to get key employees (via SERP). */
export function buildPeopleInput(companyUrls: string[]) {
  return {
    urls: companyUrls,
    mode: "company_employees",
    maxResults: companyUrls.length * 15, // ~15 key people per company
  };
}
