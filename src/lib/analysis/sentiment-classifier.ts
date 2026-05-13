/**
 * Batched sentiment classification for comment-type engagements.
 *
 * Each comment is graded by stance toward the *competitor whose post it sits
 * on* (not toward the commenter's own employer). Three classes:
 *
 *   positive  — praises competitor / endorses product / expresses interest
 *               in adopting. The Sepio-AE "alarm" case.
 *   negative  — criticises competitor / mentions alternatives favourably
 *               / expresses frustration. The Sepio-AE "opening" case.
 *   neutral   — generic ('congrats!'), question, off-topic, employee-internal.
 *
 * One Groq call per scrape, up to ~50 comments per batch. Silent no-op
 * without GROQ_API_KEY (rows stay null and the strength function falls
 * back to its neutral defaults).
 */
import { db } from "@/db";
import {
  postEngagements,
  companyPosts,
  companies,
} from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { callGroqJson, hasGroqKey } from "../llm/groq";

const VALID = new Set(["positive", "negative", "neutral"]);
const BATCH_SIZE = 50;

interface CommentBatchItem {
  id: number;
  text: string;
  competitor: string;
}

interface ClassifierResult {
  results?: Array<{ id: number | string; sentiment: string }>;
}

async function classifyBatch(
  items: CommentBatchItem[],
): Promise<Map<number, "positive" | "negative" | "neutral">> {
  const out = new Map<number, "positive" | "negative" | "neutral">();
  if (!hasGroqKey() || items.length === 0) return out;

  const payload = items.map((it) => ({
    id: it.id,
    competitor: it.competitor,
    comment: it.text.replace(/\s+/g, " ").trim().slice(0, 400),
  }));

  const prompt = `Each item is a LinkedIn comment posted under a post by a cybersecurity vendor (the "competitor"). Classify the commenter's stance TOWARD THE COMPETITOR.

Classes:
- positive: praises the competitor / endorses the product / signals interest in adopting it
- negative: criticises the competitor / mentions alternatives favourably / expresses frustration with their offering
- neutral: generic agreement ("congrats", "great work"), question, off-topic, employee-internal banter

Comments (JSON): ${JSON.stringify(payload)}

Return JSON: {"results":[{"id":<id>,"sentiment":"<class>"}]}. Every input id must appear once. Use "neutral" when genuinely unclear.`;

  try {
    const parsed = await callGroqJson<ClassifierResult>(prompt, {
      temperature: 0.1,
      maxTokens: 1200,
    });
    if (!parsed?.results) return out;
    for (const r of parsed.results) {
      const id = typeof r.id === "string" ? parseInt(r.id, 10) : r.id;
      if (!Number.isFinite(id)) continue;
      const sent = (r.sentiment || "").toLowerCase();
      if (VALID.has(sent)) {
        out.set(id as number, sent as "positive" | "negative" | "neutral");
      }
    }
  } catch (e) {
    console.warn(
      "[sentiment] batch failed:",
      e instanceof Error ? e.message : e,
    );
  }
  return out;
}

/**
 * Classify every comment-type postEngagements row that:
 *   - has non-null commentText
 *   - has null sentiment (i.e. not yet classified)
 *   - sits on a post owned by a category='competitor' company
 *
 * Updates the sentiment column in place. Returns how many rows got a
 * sentiment assigned.
 */
export async function classifyPendingComments(): Promise<number> {
  if (!hasGroqKey()) {
    console.log("[sentiment] GROQ_API_KEY not set — skipping");
    return 0;
  }

  const rows = await db
    .select({
      id: postEngagements.id,
      text: postEngagements.commentText,
      competitor: companies.name,
    })
    .from(postEngagements)
    .innerJoin(companyPosts, eq(postEngagements.postId, companyPosts.id))
    .innerJoin(companies, eq(companyPosts.companyId, companies.id))
    .where(
      and(
        eq(postEngagements.engagementType, "comment"),
        isNull(postEngagements.sentiment),
        eq(companies.category, "competitor"),
      ),
    )
    .all();

  const eligible = rows.filter((r) => (r.text ?? "").trim().length >= 3);
  console.log(`[sentiment] ${eligible.length} pending comments`);
  if (eligible.length === 0) return 0;

  let updated = 0;
  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);
    const results = await classifyBatch(
      batch.map((r) => ({
        id: r.id,
        text: r.text ?? "",
        competitor: r.competitor,
      })),
    );

    // Write back
    const positive: number[] = [];
    const negative: number[] = [];
    const neutral: number[] = [];
    for (const [id, sent] of results) {
      if (sent === "positive") positive.push(id);
      else if (sent === "negative") negative.push(id);
      else neutral.push(id);
    }
    if (positive.length)
      await db
        .update(postEngagements)
        .set({ sentiment: "positive" })
        .where(inArray(postEngagements.id, positive));
    if (negative.length)
      await db
        .update(postEngagements)
        .set({ sentiment: "negative" })
        .where(inArray(postEngagements.id, negative));
    if (neutral.length)
      await db
        .update(postEngagements)
        .set({ sentiment: "neutral" })
        .where(inArray(postEngagements.id, neutral));

    updated += positive.length + negative.length + neutral.length;
    console.log(
      `[sentiment] batch ${i / BATCH_SIZE + 1}: +${positive.length} pos / +${negative.length} neg / +${neutral.length} neu`,
    );
  }

  // Backfill sentiment into clientInteractions rows that came from these
  // engagements (matched by post + engager URL).
  await backfillInteractionSentiment();

  return updated;
}

/**
 * Propagate sentiment from postEngagements into the denormalised column on
 * clientInteractions, so downstream strength + lead-score queries don't need
 * a join.
 */
export async function backfillInteractionSentiment(): Promise<number> {
  // Single UPDATE … FROM-equivalent via a subquery. SQLite supports
  // correlated subqueries here.
  const res = await db.run(`
    UPDATE client_interactions
    SET sentiment = (
      SELECT pe.sentiment
      FROM post_engagements pe
      WHERE pe.post_id = client_interactions.post_id
        AND pe.engager_linkedin_url = client_interactions.engager_profile_url
        AND pe.engagement_type = 'comment'
        AND pe.sentiment IS NOT NULL
      LIMIT 1
    )
    WHERE client_interactions.signal_type = 'post_engagement'
      AND client_interactions.sentiment IS NULL
  `);
  return (res as { rowsAffected?: number }).rowsAffected ?? 0;
}
