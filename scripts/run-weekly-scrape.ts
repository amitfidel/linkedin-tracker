/**
 * Local weekly scrape — invoked by Windows Task Scheduler, Mon 2:00 local time.
 * Replaces the GitHub-Actions-→-Railway path now that Railway is decommissioned.
 *
 * Mirrors /api/scrape/cron's behavior: reaps hung runs, refuses overlap,
 * honors scheduleConfig.isEnabled, and awaits runPipeline("scheduled") so
 * the digest email fires at the end (orchestrator only emails on scheduled runs).
 *
 * Usage:
 *   npx tsx scripts/run-weekly-scrape.ts
 */
import "dotenv/config";
import { db } from "../src/db";
import { scrapeRuns, scheduleConfig } from "../src/db/schema";
import { and, desc, eq, lt } from "drizzle-orm";
import { runPipeline } from "../src/lib/pipeline/orchestrator";

async function main() {
  // Reap hung runs older than 15 min (server crash / interrupted task)
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await db
    .update(scrapeRuns)
    .set({
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "Interrupted (previous run hung)",
    })
    .where(
      and(
        eq(scrapeRuns.status, "running"),
        lt(scrapeRuns.startedAt, fifteenMinutesAgo),
      ),
    );

  // Refuse if a recent run is still in progress
  const latest = await db
    .select({ id: scrapeRuns.id, status: scrapeRuns.status })
    .from(scrapeRuns)
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(1)
    .get();

  if (latest?.status === "running") {
    console.log(`[weekly] skipping — run #${latest.id} is still in progress`);
    return;
  }

  // Honor disabled toggle from /settings
  const cfg = await db
    .select()
    .from(scheduleConfig)
    .where(eq(scheduleConfig.id, 1))
    .get();
  if (cfg && cfg.isEnabled === false) {
    console.log("[weekly] skipping — schedule disabled in settings");
    return;
  }

  console.log(
    `[weekly] starting scheduled scrape at ${new Date().toISOString()}`,
  );

  const result = await runPipeline("scheduled");
  console.log("[weekly] result:", JSON.stringify(result, null, 2));

  // Update lastRunAt mirror (settings page reads this)
  await db
    .update(scheduleConfig)
    .set({ lastRunAt: new Date().toISOString() })
    .where(eq(scheduleConfig.id, 1));
}

main()
  .then(() => {
    console.log("[weekly] done");
    process.exit(0);
  })
  .catch((e) => {
    console.error("[weekly] failed:", e);
    process.exit(1);
  });
