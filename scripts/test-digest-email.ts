/**
 * Manually send the weekly digest email using the latest stored AI summary.
 *
 * Usage:
 *   npx tsx scripts/test-digest-email.ts
 *
 * Requires RESEND_API_KEY and DIGEST_EMAIL_TO in .env.
 */
import "dotenv/config";
import { db } from "../src/db";
import { scrapeRuns } from "../src/db/schema";
import { desc, eq, and, isNotNull } from "drizzle-orm";
import { sendWeeklyDigest } from "../src/lib/email/weekly-digest";

async function main() {
  const latest = await db
    .select()
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.status, "completed"), isNotNull(scrapeRuns.aiSummary)))
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(1)
    .get();

  if (!latest || !latest.aiSummary) {
    console.error("No completed run with an AI summary found. Run a scrape first.");
    process.exit(1);
  }

  const stepErrors: string[] = latest.stepErrors ? JSON.parse(latest.stepErrors) : [];

  console.log(`Using run #${latest.id} (${latest.startedAt}). Sending…`);
  await sendWeeklyDigest({
    summaryMarkdown: latest.aiSummary,
    companiesCount: latest.companiesCount ?? 0,
    creditsUsed: latest.creditsUsed ?? 0,
    runId: latest.id,
    stepErrors,
  });
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
