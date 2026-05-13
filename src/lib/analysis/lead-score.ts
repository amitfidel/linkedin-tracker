/**
 * Per-client "warmth" / lead-score aggregation.
 *
 * Sums weighted signal strengths over a rolling window into a single number
 * per client. The score answers: "If I had time to act on one account today,
 * which one?"
 *
 * Weights mirror the alert-strength function in notify/slack.ts — same
 * ranking, same intuition (personnel moves crush everything else, comments
 * beat likes, mentions sit at the bottom). The total score is just a sum
 * of strengths across all interactions in the window.
 *
 * Decay: signals older than half the window get half weight, so a client
 * with a 5-day-old comment ranks below one with a same-day comment.
 */
import { db } from "@/db";
import { clientInteractions, companies } from "@/db/schema";
import { and, gte, inArray, eq } from "drizzle-orm";
import { signalStrength } from "./signal-strength";

interface RawSignal {
  id: number;
  clientCompanyId: number;
  competitorCompanyId: number;
  signalType: string;
  summary: string | null;
  detectedAt: string | null;
  sentiment: string | null;
}

function baseStrength(s: RawSignal): number {
  return signalStrength(s);
}

function decayedStrength(s: RawSignal, halfLifeMs: number): number {
  const t = s.detectedAt ? Date.parse(s.detectedAt) : Date.now();
  const age = Date.now() - t;
  if (age <= 0) return baseStrength(s);
  // Linear decay to 0.5 at half-life, 0.0 at full window. Bounded at 0.25.
  const factor = Math.max(0.25, 1 - age / (2 * halfLifeMs));
  return Math.round(baseStrength(s) * factor);
}

export interface LeadScoreRow {
  clientCompanyId: number;
  clientName: string;
  score: number;
  signalCount: number;
  topCompetitor: string | null; // competitor with highest score against this client
  topSignalSummary: string | null; // strongest single signal
  signalsByType: Record<string, number>;
}

/**
 * Returns one row per client that has at least one interaction in the
 * window. Sorted by score desc.
 */
export async function computeLeadScores(opts: {
  sinceDays?: number;
}): Promise<LeadScoreRow[]> {
  const sinceDays = opts.sinceDays ?? 30;
  const halfLifeMs = (sinceDays * 86400_000) / 2;
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();

  const rows = await db
    .select({
      id: clientInteractions.id,
      clientCompanyId: clientInteractions.clientCompanyId,
      competitorCompanyId: clientInteractions.competitorCompanyId,
      signalType: clientInteractions.signalType,
      summary: clientInteractions.summary,
      detectedAt: clientInteractions.detectedAt,
      sentiment: clientInteractions.sentiment,
    })
    .from(clientInteractions)
    .where(gte(clientInteractions.detectedAt, since))
    .all();

  if (rows.length === 0) return [];

  // Hydrate names
  const ids = Array.from(
    new Set(rows.flatMap((r) => [r.clientCompanyId, r.competitorCompanyId])),
  );
  const names = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, ids))
    .all();
  const nameMap = new Map(names.map((c) => [c.id, c.name]));

  // Aggregate per client
  type Agg = {
    score: number;
    signalCount: number;
    perCompetitor: Map<number, number>;
    bestSignal: { strength: number; summary: string | null } | null;
    byType: Record<string, number>;
  };
  const per = new Map<number, Agg>();

  for (const r of rows) {
    const strength = decayedStrength(r, halfLifeMs);
    let agg = per.get(r.clientCompanyId);
    if (!agg) {
      agg = {
        score: 0,
        signalCount: 0,
        perCompetitor: new Map(),
        bestSignal: null,
        byType: {},
      };
      per.set(r.clientCompanyId, agg);
    }
    agg.score += strength;
    agg.signalCount += 1;
    agg.perCompetitor.set(
      r.competitorCompanyId,
      (agg.perCompetitor.get(r.competitorCompanyId) ?? 0) + strength,
    );
    agg.byType[r.signalType] = (agg.byType[r.signalType] ?? 0) + 1;
    if (!agg.bestSignal || strength > agg.bestSignal.strength) {
      agg.bestSignal = { strength, summary: r.summary };
    }
  }

  const out: LeadScoreRow[] = [];
  for (const [clientId, agg] of per) {
    let topCompetitor: number | null = null;
    let topCompScore = -1;
    for (const [cid, score] of agg.perCompetitor) {
      if (score > topCompScore) {
        topCompScore = score;
        topCompetitor = cid;
      }
    }
    out.push({
      clientCompanyId: clientId,
      clientName: nameMap.get(clientId) ?? "?",
      score: agg.score,
      signalCount: agg.signalCount,
      topCompetitor: topCompetitor ? (nameMap.get(topCompetitor) ?? null) : null,
      topSignalSummary: agg.bestSignal?.summary ?? null,
      signalsByType: agg.byType,
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Convenience: pull the score for a single client (or 0 if no signals). */
export async function leadScoreFor(
  clientCompanyId: number,
  sinceDays = 30,
): Promise<number> {
  const all = await computeLeadScores({ sinceDays });
  return all.find((r) => r.clientCompanyId === clientCompanyId)?.score ?? 0;
}

void and;
void eq;
