/**
 * Slack alerts for high-strength client interactions.
 *
 * One incoming webhook URL is all we need. Skips silently when
 * SLACK_WEBHOOK_URL is not configured, so the pipeline keeps working
 * for users who don't want real-time pings.
 *
 *   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/.../...
 *   SLACK_MIN_STRENGTH=70   (optional, default 70)
 */
import { db } from "@/db";
import { clientInteractions, companies, companyPosts } from "@/db/schema";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { signalStrength } from "../analysis/signal-strength";

export interface SignalForAlert {
  id: number;
  clientName: string;
  competitorName: string;
  signalType: string;
  summary: string | null;
  matchedBy: string | null;
  engagerName: string | null;
  engagerProfileUrl: string | null;
  postUrl: string | null;
  sentiment?: string | null;
}

export { signalStrength };

function emojiForSignal(t: string): string {
  if (t === "personnel_move") return "🚨";
  if (t === "post_engagement") return "👀";
  if (t === "post_mention") return "💬";
  return "•";
}

function buildBlocks(signals: SignalForAlert[]) {
  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🔔 ${signals.length} new client signal${signals.length === 1 ? "" : "s"}`,
      },
    },
  ];

  for (const s of signals) {
    const matchTag = s.matchedBy ? ` _via ${s.matchedBy}_` : "";
    const lines = [
      `${emojiForSignal(s.signalType)} *${s.clientName}* ↔ _${s.competitorName}_${matchTag}`,
      s.summary ?? "",
    ];
    if (s.postUrl) lines.push(`<${s.postUrl}|open post>`);
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.filter(Boolean).join("\n") },
    });
    blocks.push({ type: "divider" });
  }

  return blocks;
}

/**
 * Fetch every clientInteraction with `alertedAt IS NULL` whose strength meets
 * the threshold. Returns enriched rows with client name, competitor name,
 * and post URL hydrated.
 */
export async function pendingAlerts(
  minStrength: number,
): Promise<SignalForAlert[]> {
  const rows = await db
    .select({
      id: clientInteractions.id,
      clientCompanyId: clientInteractions.clientCompanyId,
      competitorCompanyId: clientInteractions.competitorCompanyId,
      signalType: clientInteractions.signalType,
      summary: clientInteractions.summary,
      matchedBy: clientInteractions.matchedBy,
      engagerName: clientInteractions.engagerName,
      engagerProfileUrl: clientInteractions.engagerProfileUrl,
      postId: clientInteractions.postId,
      sentiment: clientInteractions.sentiment,
    })
    .from(clientInteractions)
    .where(isNull(clientInteractions.alertedAt))
    .all();

  if (rows.length === 0) return [];

  // Filter by strength
  const strong = rows.filter((r) => signalStrength(r) >= minStrength);
  if (strong.length === 0) return [];

  // Hydrate company names + post URLs
  const companyIds = Array.from(
    new Set(strong.flatMap((r) => [r.clientCompanyId, r.competitorCompanyId])),
  );
  const nameRows = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, companyIds))
    .all();
  const nameMap = new Map(nameRows.map((c) => [c.id, c.name]));

  const postIds = strong
    .map((r) => r.postId)
    .filter((x): x is number => x != null);
  const postRows = postIds.length
    ? await db
        .select({
          id: companyPosts.id,
          url: companyPosts.linkedinPostId,
        })
        .from(companyPosts)
        .where(inArray(companyPosts.id, postIds))
        .all()
    : [];
  const postMap = new Map(postRows.map((p) => [p.id, p.url]));

  return strong.map((r) => ({
    id: r.id,
    clientName: nameMap.get(r.clientCompanyId) ?? "?",
    competitorName: nameMap.get(r.competitorCompanyId) ?? "?",
    signalType: r.signalType,
    summary: r.summary,
    matchedBy: r.matchedBy,
    engagerName: r.engagerName,
    engagerProfileUrl: r.engagerProfileUrl,
    postUrl: r.postId ? (postMap.get(r.postId) ?? null) : null,
    sentiment: r.sentiment,
  }));
}

/**
 * Push pending alerts to Slack and mark them alertedAt = now().
 * Returns the count of signals sent. No-op if SLACK_WEBHOOK_URL is unset.
 */
export async function sendSlackAlert(
  signals: SignalForAlert[],
): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook || signals.length === 0) return;

  // Slack caps a message at 50 blocks. Each signal uses 2 (section + divider).
  const CHUNK = 20;
  for (let i = 0; i < signals.length; i += CHUNK) {
    const chunk = signals.slice(i, i + CHUNK);
    const body = {
      text: `🔔 ${chunk.length} new client signal${chunk.length === 1 ? "" : "s"}`,
      blocks: buildBlocks(chunk),
    };
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Slack webhook ${res.status}: ${txt.slice(0, 200)}`);
    }
  }
  void sql;
  void and;
  void eq;
}

// ── Top-level dispatcher: pick a channel based on env + send ────────────────
import { sendEmailAlert } from "./email-alert";

/**
 * Sends pending high-strength alerts via the configured channel and marks
 * them alertedAt = now(). Channel preference:
 *   1. SLACK_WEBHOOK_URL set → Slack
 *   2. else DIGEST_EMAIL_TO set → email (uses Resend, same as weekly digest)
 *   3. else → skip (logs a warning)
 *
 * Returns the number of signals dispatched.
 */
export async function dispatchAlerts(): Promise<number> {
  const minStrength = parseInt(process.env.SLACK_MIN_STRENGTH ?? "70", 10);
  const signals = await pendingAlerts(minStrength);
  if (signals.length === 0) return 0;

  const hasSlack = !!process.env.SLACK_WEBHOOK_URL;
  const hasEmail = !!process.env.DIGEST_EMAIL_TO;

  if (hasSlack) {
    await sendSlackAlert(signals);
  } else if (hasEmail) {
    await sendEmailAlert(signals);
  } else {
    console.warn(
      "[alerts] no channel configured (SLACK_WEBHOOK_URL or DIGEST_EMAIL_TO)",
    );
    return 0;
  }

  // Mark all signals as alerted
  const ids = signals.map((s) => s.id);
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    await db
      .update(clientInteractions)
      .set({ alertedAt: now })
      .where(inArray(clientInteractions.id, batch));
  }

  return signals.length;
}

// Legacy alias — anything that called dispatchSlackAlerts still works.
export const dispatchSlackAlerts = dispatchAlerts;
