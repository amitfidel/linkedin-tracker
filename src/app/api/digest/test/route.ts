export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scrapeRuns } from "@/db/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { sendWeeklyDigest } from "@/lib/email/weekly-digest";

/**
 * POST /api/digest/test
 *
 * Re-sends the weekly digest email using the most recent stored AI summary.
 * Used to verify Resend wiring on Railway without burning a full Apify scrape.
 * Requires Bearer SCRAPE_CRON_SECRET (same secret as /api/scrape/cron).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SCRAPE_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SCRAPE_CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const latest = await db
    .select()
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.status, "completed"), isNotNull(scrapeRuns.aiSummary)))
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(1)
    .get();

  if (!latest?.aiSummary) {
    return NextResponse.json({ error: "no completed run with aiSummary found" }, { status: 404 });
  }

  const stepErrors: string[] = latest.stepErrors ? JSON.parse(latest.stepErrors) : [];

  try {
    await sendWeeklyDigest({
      summaryMarkdown: latest.aiSummary,
      companiesCount: latest.companiesCount ?? 0,
      creditsUsed: latest.creditsUsed ?? 0,
      runId: latest.id,
      stepErrors,
    });
    return NextResponse.json({ sent: true, runId: latest.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ sent: false, error: msg }, { status: 500 });
  }
}
