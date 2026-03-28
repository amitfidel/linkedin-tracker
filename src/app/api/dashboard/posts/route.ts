export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { companyPosts, companies } from "@/db/schema";
import { eq, desc, gte, sql } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30");
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Recent posts with company info
  const posts = await db
    .select({
      id: companyPosts.id,
      companyId: companyPosts.companyId,
      companyName: companies.name,
      content: companyPosts.content,
      postType: companyPosts.postType,
      likesCount: companyPosts.likesCount,
      commentsCount: companyPosts.commentsCount,
      sharesCount: companyPosts.sharesCount,
      postedAt: companyPosts.postedAt,
      hashtags: companyPosts.hashtags,
    })
    .from(companyPosts)
    .innerJoin(companies, eq(companyPosts.companyId, companies.id))
    .where(gte(companyPosts.scrapedAt, since))
    .orderBy(desc(companyPosts.postedAt))
    .limit(100);

  // Engagement by company
  const engagement = await db
    .select({
      companyName: companies.name,
      companyId: companies.id,
      postCount: sql<number>`count(*)`,
      totalLikes: sql<number>`coalesce(sum(${companyPosts.likesCount}), 0)`,
      totalComments: sql<number>`coalesce(sum(${companyPosts.commentsCount}), 0)`,
      totalShares: sql<number>`coalesce(sum(${companyPosts.sharesCount}), 0)`,
    })
    .from(companyPosts)
    .innerJoin(companies, eq(companyPosts.companyId, companies.id))
    .where(gte(companyPosts.scrapedAt, since))
    .groupBy(companyPosts.companyId)
    .orderBy(desc(sql`sum(${companyPosts.likesCount})`));

  // Hashtag frequency
  const allHashtags = new Map<string, number>();
  for (const post of posts) {
    if (post.hashtags) {
      const tags = JSON.parse(post.hashtags) as string[];
      for (const tag of tags) {
        allHashtags.set(tag, (allHashtags.get(tag) || 0) + 1);
      }
    }
  }
  const topHashtags = Array.from(allHashtags.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  return NextResponse.json({ posts, engagement, topHashtags });
}
