export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  companies,
  clientInteractions,
  companyPosts,
} from "@/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";

/**
 * GET /api/clients/:id
 * Returns a single client's metadata + ALL their interactions, with the
 * referenced competitor name + linked post URL (when applicable).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const clientId = parseInt(id, 10);
  if (!Number.isFinite(clientId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const client = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, clientId), eq(companies.category, "client")))
    .get();
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });

  const interactions = await db
    .select({
      id: clientInteractions.id,
      signalType: clientInteractions.signalType,
      summary: clientInteractions.summary,
      matchedBy: clientInteractions.matchedBy,
      engagerName: clientInteractions.engagerName,
      engagerProfileUrl: clientInteractions.engagerProfileUrl,
      competitorCompanyId: clientInteractions.competitorCompanyId,
      postId: clientInteractions.postId,
      detectedAt: clientInteractions.detectedAt,
    })
    .from(clientInteractions)
    .where(eq(clientInteractions.clientCompanyId, clientId))
    .orderBy(desc(clientInteractions.detectedAt))
    .all();

  // Hydrate competitor names + post URLs
  const competitorIds = Array.from(
    new Set(interactions.map((i) => i.competitorCompanyId)),
  );
  const postIds = interactions
    .map((i) => i.postId)
    .filter((x): x is number => x != null);

  const competitorNames = competitorIds.length
    ? await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(inArray(companies.id, competitorIds))
        .all()
    : [];
  const cMap = new Map(competitorNames.map((c) => [c.id, c.name]));

  const postRows = postIds.length
    ? await db
        .select({
          id: companyPosts.id,
          url: companyPosts.linkedinPostId,
          snippet: companyPosts.content,
          postedAt: companyPosts.postedAt,
        })
        .from(companyPosts)
        .where(inArray(companyPosts.id, postIds))
        .all()
    : [];
  const pMap = new Map(postRows.map((p) => [p.id, p]));

  const enriched = interactions.map((i) => ({
    ...i,
    competitorName: cMap.get(i.competitorCompanyId) ?? "?",
    post: i.postId ? pMap.get(i.postId) : null,
  }));

  return NextResponse.json({ client, interactions: enriched });
}
