export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies, gartnerInsights, scrapeRuns } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * POST /api/scrape/gartner-push
 *
 * Accepts Gartner insights scraped locally (via Playwright on the user's machine)
 * and writes them to the production database.
 *
 * Body: {
 *   insights: Array<{
 *     companyId: number;
 *     type: "like" | "dislike";
 *     text: string;
 *     reviewUrl?: string;
 *     reviewerRole?: string;
 *     reviewerIndustry?: string;
 *   }>
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const insights = body?.insights;

    if (!Array.isArray(insights) || insights.length === 0) {
      return NextResponse.json(
        { error: "Missing or empty 'insights' array" },
        { status: 400 }
      );
    }

    // Create a scrape run record
    const [run] = await db
      .insert(scrapeRuns)
      .values({
        triggerType: "manual",
        status: "running",
        startedAt: new Date().toISOString(),
      })
      .returning();

    let newCount = 0;
    let skipCount = 0;
    const companyIds = new Set<number>();

    for (const insight of insights) {
      if (!insight.companyId || !insight.type || !insight.text) continue;
      companyIds.add(insight.companyId);

      // Compute SHA-256 hash
      const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(insight.text)
      );
      const hash = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Dedup by textHash
      const existing = await db
        .select({ id: gartnerInsights.id })
        .from(gartnerInsights)
        .where(
          and(
            eq(gartnerInsights.companyId, insight.companyId),
            eq(gartnerInsights.textHash, hash)
          )
        )
        .get();

      if (existing) {
        skipCount++;
        continue;
      }

      await db.insert(gartnerInsights).values({
        companyId: insight.companyId,
        scrapeRunId: run.id,
        type: insight.type,
        text: insight.text,
        textHash: hash,
        reviewUrl: insight.reviewUrl ?? null,
        reviewerRole: insight.reviewerRole ?? "",
        reviewerIndustry: insight.reviewerIndustry ?? "",
        scrapedAt: new Date().toISOString(),
      });
      newCount++;
    }

    // Complete the scrape run
    await db
      .update(scrapeRuns)
      .set({
        status: "completed",
        completedAt: new Date().toISOString(),
        companiesCount: companyIds.size,
        creditsUsed: 0,
      })
      .where(eq(scrapeRuns.id, run.id));

    return NextResponse.json({
      success: true,
      runId: run.id,
      newInsights: newCount,
      skipped: skipCount,
      companies: companyIds.size,
    });
  } catch (error) {
    console.error("[gartner-push] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
