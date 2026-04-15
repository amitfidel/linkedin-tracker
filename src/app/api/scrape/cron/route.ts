export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline/orchestrator";
import { db } from "@/db";
import { scrapeRuns, scheduleConfig } from "@/db/schema";
import { eq, and, lt, desc } from "drizzle-orm";

/**
 * POST /api/scrape/cron
 *
 * Called by an external cron service (GitHub Actions). Requires the
 * Authorization: Bearer <SCRAPE_CRON_SECRET> header to match the env var.
 *
 * Honors scheduleConfig.isEnabled — if disabled, returns 200 without running.
 * Only starts a scrape if there isn't one already running (DB-checked so it
 * survives server restarts across Railway deploys).
 */
export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const secret = process.env.SCRAPE_CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "SCRAPE_CRON_SECRET not configured on server" },
      { status: 500 }
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Reap hung runs (same 15-min window as /api/scrape) ────────────────
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await db
    .update(scrapeRuns)
    .set({
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "Interrupted (server restart)",
    })
    .where(
      and(
        eq(scrapeRuns.status, "running"),
        lt(scrapeRuns.startedAt, fifteenMinutesAgo)
      )
    );

  // ── Reject if a scrape is already in progress ─────────────────────────
  const latest = await db
    .select({ id: scrapeRuns.id, status: scrapeRuns.status })
    .from(scrapeRuns)
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(1)
    .get();

  if (latest?.status === "running") {
    return NextResponse.json(
      { skipped: "already_running", runId: latest.id },
      { status: 409 }
    );
  }

  // ── Check schedule config ─────────────────────────────────────────────
  const config = await db
    .select()
    .from(scheduleConfig)
    .where(eq(scheduleConfig.id, 1))
    .get();

  if (config && config.isEnabled === false) {
    return NextResponse.json({ skipped: "disabled" });
  }

  // ── Fire-and-forget pipeline ──────────────────────────────────────────
  runPipeline("scheduled")
    .then((result) => console.log("[cron] scheduled scrape done:", result))
    .catch((err) => console.error("[cron] scheduled scrape failed:", err));

  // Update lastRunAt
  await db
    .update(scheduleConfig)
    .set({ lastRunAt: new Date().toISOString() })
    .where(eq(scheduleConfig.id, 1));

  return NextResponse.json({ started: true, triggerType: "scheduled" });
}
