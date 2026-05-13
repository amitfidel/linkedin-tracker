/**
 * Daily lightweight watch — Mon–Fri 9am via Windows Task Scheduler.
 *
 *   npx tsx scripts/run-daily-watch.ts
 *
 * Scrapes competitor posts <48h, engagers on them, cross-references against
 * the client roster, and pushes high-strength signals to Slack within
 * minutes of detection. Cheap (~5–10 min) compared to the weekly full run.
 */
import "dotenv/config";
import { runDailyWatch } from "../src/lib/pipeline/daily-watch";

runDailyWatch()
  .then((r) => {
    console.log("[daily-watch] result:", JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
