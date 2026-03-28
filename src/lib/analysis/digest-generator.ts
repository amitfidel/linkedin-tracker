import { db } from "@/db";
import {
  companies,
  companyPosts,
  jobListings,
  companySnapshots,
  scrapeRuns,
} from "@/db/schema";
import { eq, gte, desc, sql } from "drizzle-orm";
import { categorizePost } from "./post-categorizer";

export async function generateWeeklyDigest() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // ── All active companies ───────────────────────────────────────────────────
  const activeCompanies = await db
    .select()
    .from(companies)
    .where(eq(companies.isActive, true))
    .orderBy(companies.name);

  // ── Recent posts (all companies, last 7 days) ──────────────────────────────
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
    .where(gte(companyPosts.scrapedAt, weekAgo))
    .orderBy(desc(companyPosts.scrapedAt));

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

  // ── Build per-company cards ────────────────────────────────────────────────
  const companyCards = activeCompanies.map((company) => {
    const posts = recentPosts
      .filter((p) => p.companyId === company.id)
      .map((p) => ({
        ...p,
        category: categorizePost(p.content ?? ""),
      }))
      // Sort: non-general categories first (they're more interesting), then by likes
      .sort((a, b) => {
        const aGeneral = a.category === "general" ? 1 : 0;
        const bGeneral = b.category === "general" ? 1 : 0;
        if (aGeneral !== bGeneral) return aGeneral - bGeneral;
        return (b.likesCount ?? 0) - (a.likesCount ?? 0);
      });

    const snap = snapshotMap.get(company.id);
    const activeJobCount = jobCountMap.get(company.id) ?? 0;

    // Category breakdown for this company
    const categoryCounts: Record<string, number> = {};
    for (const p of posts) {
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
      postCount: posts.length,
      categoryCounts,
      // Top 5 posts to show in the card (prefer interesting categories)
      posts: posts.slice(0, 5),
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

  const companiesWithPosts = companyCards.filter((c) => c.postCount > 0).length;
  const totalPostsThisWeek = recentPosts.length;
  const interestingPostsCount = recentPosts.filter(
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
