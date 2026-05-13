/**
 * Refresh the CyberTracker/ folder in your Obsidian vault from SQL.
 *
 *   npx tsx scripts/sync-obsidian.ts
 *
 * Requires:
 *   - Obsidian's "Local REST API" community plugin installed + enabled.
 *   - OBSIDIAN_API_KEY in .env (copy from the plugin's settings panel).
 *   - OBSIDIAN_API_URL in .env (optional — defaults to https://127.0.0.1:27124).
 */
import "dotenv/config";
import { syncToObsidian } from "../src/lib/obsidian/sync";

syncToObsidian()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
