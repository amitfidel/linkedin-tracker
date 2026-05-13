/**
 * Single source of truth for "how strong is this signal?". Used by:
 *   - the Slack/email alert dispatcher (gate by min-strength)
 *   - the lead-score aggregator (weighted sum per client)
 *
 * Higher = more urgent. The numbers don't matter in isolation — what
 * matters is the rank order and the gaps between tiers.
 *
 *   Personnel move                              → 100
 *   Comment + positive sentiment toward competitor → 95
 *   Comment (neutral / no sentiment yet)        → 80
 *   Comment + negative sentiment (Sepio opening) → 70
 *   Repost                                      → 60
 *   Like                                        → 40
 *   Mention                                     → 30
 *
 * Positive comments score higher than neutral because they're the loudest
 * "champion drifting" signal. Negative comments are still useful (Sepio
 * pitch opening) but less urgent than someone publicly endorsing the
 * competitor.
 */

export interface StrengthInput {
  signalType: string;
  summary: string | null;
  sentiment?: string | null; // 'positive' | 'negative' | 'neutral' | null
}

export function signalStrength(s: StrengthInput): number {
  if (s.signalType === "personnel_move") return 100;
  if (s.signalType === "post_engagement") {
    const sum = s.summary ?? "";
    if (sum.includes(' commented: "')) {
      if (s.sentiment === "positive") return 95;
      if (s.sentiment === "negative") return 70;
      return 80; // neutral or not classified
    }
    if (sum.includes(" reposted")) return 60;
    return 40; // like
  }
  if (s.signalType === "post_mention") return 30;
  return 10;
}

/** Human-readable label for a signal — used by email + Obsidian. */
export function signalLabel(s: StrengthInput): string {
  if (s.signalType === "personnel_move") return "Personnel move";
  if (s.signalType === "post_engagement") {
    const sum = s.summary ?? "";
    if (sum.includes(' commented: "')) {
      if (s.sentiment === "positive") return "Comment (positive)";
      if (s.sentiment === "negative") return "Comment (negative)";
      return "Comment";
    }
    if (sum.includes(" reposted")) return "Repost";
    return "Like";
  }
  if (s.signalType === "post_mention") return "Mention";
  return s.signalType;
}
