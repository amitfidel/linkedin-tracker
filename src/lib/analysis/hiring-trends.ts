import { db } from "@/db";
import { jobListings, companies } from "@/db/schema";
import { eq, desc, gte, sql } from "drizzle-orm";

export async function getHiringTrends(daysBack = 30) {
  const since = new Date(Date.now() - daysBack * 86400000).toISOString();

  // Job counts per company over time
  const jobCounts = await db
    .select({
      companyId: jobListings.companyId,
      companyName: companies.name,
      count: sql<number>`count(*)`,
      week: sql<string>`strftime('%Y-%W', ${jobListings.scrapedAt})`,
    })
    .from(jobListings)
    .innerJoin(companies, eq(jobListings.companyId, companies.id))
    .where(gte(jobListings.scrapedAt, since))
    .groupBy(jobListings.companyId, sql`strftime('%Y-%W', ${jobListings.scrapedAt})`)
    .orderBy(sql`strftime('%Y-%W', ${jobListings.scrapedAt})`);

  // Top skills across all jobs
  const recentJobs = await db
    .select({ skills: jobListings.skills })
    .from(jobListings)
    .where(gte(jobListings.scrapedAt, since));

  const skillCounts = new Map<string, number>();
  for (const job of recentJobs) {
    if (job.skills) {
      const skills = JSON.parse(job.skills) as string[];
      for (const skill of skills) {
        skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
      }
    }
  }

  const topSkills = Array.from(skillCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));

  // Current active jobs by company
  const activeJobsByCompany = await db
    .select({
      companyId: jobListings.companyId,
      companyName: companies.name,
      activeJobs: sql<number>`count(*)`,
    })
    .from(jobListings)
    .innerJoin(companies, eq(jobListings.companyId, companies.id))
    .where(eq(jobListings.isActive, true))
    .groupBy(jobListings.companyId)
    .orderBy(desc(sql`count(*)`));

  return { jobCounts, topSkills, activeJobsByCompany };
}
