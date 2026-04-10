import { db } from "@/db";
import {
  companies,
  companyPosts,
  jobListings,
  companySnapshots,
  scrapeRuns,
  gartnerInsights,
} from "@/db/schema";
import { eq, gte, desc, sql } from "drizzle-orm";
import { categorizePost } from "./post-categorizer";

export async function generateWeeklyDigest() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  // Fetch a wider window for display purposes (30 days) so company cards always
  // show recent posts even if the company hasn't posted in the last 7 days.
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // ── All active companies ───────────────────────────────────────────────────
  const activeCompanies = await db
    .select()
    .from(companies)
    .where(eq(companies.isActive, true))
    .orderBy(companies.name);

  // ── All posts from last 30 days (for company card display) ─────────────────
  // Filtered by postedAt so posts reflect when LinkedIn published them,
  // not when we scraped them (avoids posts vanishing after 7 days from DB insert)
  const recentPosts = await db
    .select({
      id: companyPosts.id,
      companyId: companyPosts.companyId,
      content: companyPosts.content,
      postType: companyPosts.postType,
      likesCount: companyPosts.likesCount,
      commentsCount: companyPosts.commentsCount,
      sharesCount: companyPosts.sharesCount,
      postedAt: companyPosts.postedAt,
      scrapedAt: companyPosts.scrapedAt,
      linkedinPostId: companyPosts.linkedinPostId,
      hashtags: companyPosts.hashtags,
    })
    .from(companyPosts)
    .where(gte(companyPosts.postedAt, monthAgo))
    .orderBy(desc(companyPosts.postedAt));

  // ── Active jobs per company ────────────────────────────────────────────────
  const jobCounts = await db
    .select({
      companyId: jobListings.companyId,
      jobCount: sql<number>`count(*)`,
    })
    .from(jobListings)
    .where(eq(jobListings.isActive, true))
    .groupBy(jobListings.companyId);

  const jobCountMap = new Map(jobCounts.map((j) => [j.companyId, j.jobCount]));

  // ── Latest snapshot per company (employee count, followers) ───────────────
  const latestSnapshots = await db
    .select({
      companyId: companySnapshots.companyId,
      employeeCount: companySnapshots.employeeCount,
      followerCount: companySnapshots.followerCount,
    })
    .from(companySnapshots)
    .orderBy(desc(companySnapshots.scrapedAt));

  // Keep only the most recent snapshot per company
  const snapshotMap = new Map<number, { employeeCount: number | null; followerCount: number | null }>();
  for (const snap of latestSnapshots) {
    if (!snapshotMap.has(snap.companyId)) {
      snapshotMap.set(snap.companyId, {
        employeeCount: snap.employeeCount,
        followerCount: snap.followerCount,
      });
    }
  }

  // ── Latest Gartner insights per company ───────────────────────────────────
  const allInsights = await db
    .select()
    .from(gartnerInsights)
    .orderBy(desc(gartnerInsights.scrapedAt));

  const insightsMap = new Map<number, { likes: string[]; dislikes: string[] }>();
  for (const insight of allInsights) {
    if (!insightsMap.has(insight.companyId)) {
      insightsMap.set(insight.companyId, { likes: [], dislikes: [] });
    }
    const entry = insightsMap.get(insight.companyId)!;
    if (insight.type === "like" && entry.likes.length < 3) entry.likes.push(insight.text);
    if (insight.type === "dislike" && entry.dislikes.length < 3) entry.dislikes.push(insight.text);
  }

  // ── Build per-company cards ────────────────────────────────────────────────
  const companyCards = activeCompanies.map((company) => {
    // All posts from the 30-day window for this company (sorted by postedAt desc)
    const allCompanyPosts = recentPosts
      .filter((p) => p.companyId === company.id)
      .map((p) => ({
        ...p,
        category: categorizePost(p.content ?? ""),
      }));

    // Posts from this week only — used for the "This week:" category badges
    const thisWeekPosts = allCompanyPosts.filter(
      (p) => (p.postedAt ?? "") >= weekAgo
    );

    // For display: prefer interesting (non-general) posts first, then by likes
    const sortedPosts = [...allCompanyPosts].sort((a, b) => {
      const aGeneral = a.category === "general" ? 1 : 0;
      const bGeneral = b.category === "general" ? 1 : 0;
      if (aGeneral !== bGeneral) return aGeneral - bGeneral;
      return (b.likesCount ?? 0) - (a.likesCount ?? 0);
    });

    const snap = snapshotMap.get(company.id);
    const activeJobCount = jobCountMap.get(company.id) ?? 0;

    // Category breakdown = this week's posts only (shown in "This week:" badges)
    const categoryCounts: Record<string, number> = {};
    for (const p of thisWeekPosts) {
      categoryCounts[p.category] = (categoryCounts[p.category] ?? 0) + 1;
    }

    return {
      id: company.id,
      name: company.name,
      linkedinUrl: company.linkedinUrl,
      industry: company.industry,
      description: company.description,
      logoUrl: company.logoUrl,
      website: company.website,
      employeeCount: snap?.employeeCount ?? company.employeeCount,
      followerCount: snap?.followerCount,
      activeJobCount,
      // postCount reflects 7-day activity for summary stats
      postCount: thisWeekPosts.length,
      categoryCounts,
      // Top 5 posts to show in the card (from 30-day window, best first)
      posts: sortedPosts.slice(0, 5),
      gartnerUrl: company.gartnerUrl,
      gartnerInsights: insightsMap.get(company.id) ?? null,
    };
  });

  // ── Global summary stats ───────────────────────────────────────────────────
  const totalActiveJobs = await db
    .select({ count: sql<number>`count(*)` })
    .from(jobListings)
    .where(eq(jobListings.isActive, true))
    .get();

  const lastRun = await db
    .select()
    .from(scrapeRuns)
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(1)
    .get();

  // Weekly stats use the 7-day postedAt window only
  const postsThisWeek = recentPosts.filter((p) => (p.postedAt ?? "") >= weekAgo);
  const companiesWithPosts = companyCards.filter((c) => c.postCount > 0).length;
  const totalPostsThisWeek = postsThisWeek.length;
  const interestingPostsCount = postsThisWeek.filter(
    (p) => categorizePost(p.content ?? "") !== "general"
  ).length;

  return {
    period: { from: weekAgo, to: new Date().toISOString() },
    summary: {
      totalCompanies: activeCompanies.length,
      companiesWithActivity: companiesWithPosts,
      totalActiveJobs: totalActiveJobs?.count ?? 0,
      totalPostsThisWeek,
      interestingPostsCount, // non-general (partnership / launch / funding / etc.)
    },
    companyCards,
    lastRun,
  };
}
