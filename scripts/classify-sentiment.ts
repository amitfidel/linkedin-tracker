/**
 * Backfill: classify sentiment on every existing comment-type engagement
 * that doesn't yet have one, then propagate into clientInteractions and
 * re-sync the Obsidian vault.
 *
 *   npx tsx scripts/classify-sentiment.ts
 *
 * One-shot — the orchestrator + daily-watch handle ongoing classification.
 */
import "dotenv/config";
import {
  classifyPendingComments,
  backfillInteractionSentiment,
} from "../src/lib/analysis/sentiment-classifier";
import { syncToObsidian } from "../src/lib/obsidian/sync";

async function main() {
  const n = await classifyPendingComments();
  console.log(`[backfill] classified ${n} comments`);
  const m = await backfillInteractionSentiment();
  console.log(`[backfill] propagated to ${m} client_interactions`);
  await syncToObsidian().catch(() => {});
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
