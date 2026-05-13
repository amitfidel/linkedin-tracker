import "dotenv/config";
process.env.SLACK_MIN_STRENGTH = "30";
import { dispatchAlerts } from "../src/lib/notify/slack";

dispatchAlerts()
  .then((n) => {
    console.log(`[test] dispatched ${n} signals`);
    process.exit(0);
  })
  .catch((e) => {
    console.error("[test] failed:", e);
    process.exit(1);
  });
