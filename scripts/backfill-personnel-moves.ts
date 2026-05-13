/**
 * One-shot: rebuild people_observations from all historical keyPersonnel +
 * postEngagements rows, then scan for personnel_move signals.
 *
 *   npx tsx scripts/backfill-personnel-moves.ts
 *
 * Safe to re-run — wipes peopleObservations before repopulating. The move
 * detector dedups against existing clientInteractions so re-runs don't
 * double-emit signals.
 */
import "dotenv/config";
import { db } from "../src/db";
import { scrapeRuns } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { backfillObservationsAndDetect } from "../src/lib/analysis/personnel-moves";

async function main() {
  const [run] = await db
    .insert(scrapeRuns)
    .values({
      triggerType: "manual",
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .returning();

  console.log(`backfilling under run #${run.id}…`);
  const result = await backfillObservationsAndDetect(run.id);
  console.log(
    `\n✅ wrote ${result.observations} observations, emitted ${result.moves} personnel_move signals`,
  );

  await db
    .update(scrapeRuns)
    .set({
      status: "completed",
      completedAt: new Date().toISOString(),
    })
    .where(eq(scrapeRuns.id, run.id));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
