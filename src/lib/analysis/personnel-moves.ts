/**
 * Personnel-move detector.
 *
 * Records every (profile_url, company_id) pair we see during a scrape into
 * the append-only `people_observations` table. Then scans for profile URLs
 * whose most recent observation switched companies in a way that crosses
 * client ↔ competitor — that's a personnel move worth flagging.
 *
 * Two observation sources feed in:
 *   - 'roster'      — anyone in keyPersonnel touched this run
 *   - 'engagement'  — anyone in postEngagements where we can derive their
 *                     current employer from the headline ("VP at Wells Fargo")
 */
import { db } from "@/db";
import {
  companies,
  keyPersonnel,
  postEngagements,
  peopleObservations,
  clientInteractions,
  type NewPeopleObservation,
  type NewClientInteraction,
} from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { normaliseProfileUrl } from "./client-watch";

// ── Headline → company resolver ─────────────────────────────────────────────
interface CompanyAlias {
  id: number;
  name: string;
  category: string;
  aliases: string[];
}

let aliasCache: CompanyAlias[] | null = null;

async function loadCompanyAliases(): Promise<CompanyAlias[]> {
  if (aliasCache) return aliasCache;
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      category: companies.category,
    })
    .from(companies)
    .where(inArray(companies.category, ["self", "competitor", "client"]))
    .all();

  aliasCache = rows.map((c) => {
    const lower = c.name.toLowerCase();
    const aliases = Array.from(
      new Set(
        [
          lower,
          lower.replace(/[.,]/g, ""),
          lower.replace(/\s+(inc|llc|ltd|corp|corporation|co|gmbh)\.?$/i, ""),
        ].filter((a) => a.length >= 3),
      ),
    );
    return { id: c.id, name: c.name, category: c.category, aliases };
  });
  return aliasCache;
}

/** Reset the alias cache — call when a client is added/removed. */
export function invalidateAliasCache(): void {
  aliasCache = null;
}

/**
 * Try to map an engager's headline ("VP Security at Wells Fargo") to a known
 * company id. Returns null if no client/competitor/self alias matches.
 */
export async function resolveEmployerFromHeadline(
  headline: string | null | undefined,
): Promise<number | null> {
  if (!headline) return null;
  const lower = headline.toLowerCase();
  const aliases = await loadCompanyAliases();
  // Longest-alias-first ensures "Bank Hapoalim" wins over "Bank"
  const sorted = [...aliases].flatMap((c) =>
    c.aliases.map((a) => ({ id: c.id, alias: a })),
  );
  sorted.sort((a, b) => b.alias.length - a.alias.length);
  for (const { id, alias } of sorted) {
    if (lower.includes(alias)) return id;
  }
  return null;
}

// ── Record observations from this run ──────────────────────────────────────
/**
 * Insert peopleObservations rows from this scrape run.
 *   - Every keyPersonnel row updated/inserted this run → source='roster'
 *   - Every postEngagement inserted this run, if we can resolve their
 *     headline to a known company → source='engagement'
 *
 * Returns the number of observations inserted.
 */
export async function recordPeopleObservations(runId: number): Promise<number> {
  let inserted = 0;

  // 1. Roster observations
  const rosterRows = await db
    .select({
      profileUrl: keyPersonnel.linkedinProfileUrl,
      companyId: keyPersonnel.companyId,
      name: keyPersonnel.name,
      title: keyPersonnel.title,
    })
    .from(keyPersonnel)
    .where(eq(keyPersonnel.scrapeRunId, runId))
    .all();

  for (const r of rosterRows) {
    const profile = normaliseProfileUrl(r.profileUrl ?? "");
    if (!profile) continue;
    const row: NewPeopleObservation = {
      linkedinProfileUrl: profile,
      companyId: r.companyId,
      name: r.name,
      headline: r.title,
      source: "roster",
      scrapeRunId: runId,
    };
    await db.insert(peopleObservations).values(row);
    inserted++;
  }

  // 2. Engagement observations — only when headline resolves to a known company
  const engRows = await db
    .select({
      profileUrl: postEngagements.engagerLinkedinUrl,
      name: postEngagements.engagerName,
      headline: postEngagements.engagerHeadline,
    })
    .from(postEngagements)
    .where(eq(postEngagements.scrapeRunId, runId))
    .all();

  for (const e of engRows) {
    const profile = normaliseProfileUrl(e.profileUrl ?? "");
    if (!profile) continue;
    const companyId = await resolveEmployerFromHeadline(e.headline);
    if (!companyId) continue;
    const row: NewPeopleObservation = {
      linkedinProfileUrl: profile,
      companyId,
      name: e.name,
      headline: e.headline,
      source: "engagement",
      scrapeRunId: runId,
    };
    await db.insert(peopleObservations).values(row);
    inserted++;
  }

  return inserted;
}

// ── Detect cross-category moves ─────────────────────────────────────────────
interface ObsRow {
  id: number;
  profile: string;
  companyId: number;
  name: string | null;
  headline: string | null;
  category: string;
  observedAt: string | null;
}

/**
 * Walk every profile URL that has observations at ≥2 different companies and
 * the most recent transition crosses client ↔ competitor. Emit a
 * clientInteractions row for each move, with strong dedup.
 */
export async function detectMoves(runId: number): Promise<number> {
  // Pull every observation joined with the observed company's category.
  // Order by profile, then time, so we can walk transitions sequentially.
  const rows = await db
    .select({
      id: peopleObservations.id,
      profile: peopleObservations.linkedinProfileUrl,
      companyId: peopleObservations.companyId,
      name: peopleObservations.name,
      headline: peopleObservations.headline,
      category: companies.category,
      observedAt: peopleObservations.observedAt,
    })
    .from(peopleObservations)
    .innerJoin(companies, eq(peopleObservations.companyId, companies.id))
    .orderBy(peopleObservations.linkedinProfileUrl, peopleObservations.observedAt)
    .all();

  const byProfile = new Map<string, ObsRow[]>();
  for (const r of rows as ObsRow[]) {
    const arr = byProfile.get(r.profile) ?? [];
    arr.push(r);
    byProfile.set(r.profile, arr);
  }

  let emitted = 0;
  for (const [profile, history] of byProfile) {
    if (history.length < 2) continue;
    // Find the latest *transition*: the most recent pair where companyId
    // differs from the previous distinct company.
    let prev: ObsRow | null = null;
    for (const obs of history) {
      if (!prev) {
        prev = obs;
        continue;
      }
      if (obs.companyId !== prev.companyId) {
        // Transition prev → obs. Only flag when the cross is client ↔ competitor.
        const ca = prev.category;
        const cb = obs.category;
        const crosses =
          (ca === "client" && cb === "competitor") ||
          (ca === "competitor" && cb === "client");
        if (crosses) {
          const clientCompanyId = ca === "client" ? prev.companyId : obs.companyId;
          const competitorCompanyId =
            ca === "competitor" ? prev.companyId : obs.companyId;
          const direction =
            ca === "client"
              ? "left client → joined competitor"
              : "left competitor → joined client";
          const personName = obs.name ?? prev.name ?? "Someone";
          const prevDate = (prev.observedAt ?? "").slice(0, 10);
          const obsDate = (obs.observedAt ?? "").slice(0, 10);
          const summary = `${personName} — ${direction} (last seen ${prevDate}, now ${obsDate})`;

          // Dedup: same profile + same client + signalType already exists?
          const existing = await db
            .select({ id: clientInteractions.id })
            .from(clientInteractions)
            .where(
              and(
                eq(clientInteractions.clientCompanyId, clientCompanyId),
                eq(clientInteractions.competitorCompanyId, competitorCompanyId),
                eq(clientInteractions.signalType, "personnel_move"),
                eq(clientInteractions.engagerProfileUrl, profile),
              ),
            )
            .get();
          if (existing) {
            prev = obs;
            continue;
          }

          const row: NewClientInteraction = {
            clientCompanyId,
            competitorCompanyId,
            signalType: "personnel_move",
            engagerName: personName,
            engagerProfileUrl: profile,
            summary,
            matchedBy: "profile_url",
            scrapeRunId: runId,
          };
          await db.insert(clientInteractions).values(row);
          console.log(`[personnel-moves] ${summary} (${profile})`);
          emitted++;
        }
        prev = obs;
      }
    }
  }
  return emitted;
}

// ── One-shot backfill — replays existing keyPersonnel + postEngagements ────
/**
 * Wipe peopleObservations then re-populate from all historical data.
 * After re-population, runs detectMoves once to catch any moves already
 * latent in the history.
 */
export async function backfillObservationsAndDetect(
  runId: number,
): Promise<{ observations: number; moves: number }> {
  console.log("[personnel-moves:backfill] wiping observations…");
  await db.delete(peopleObservations);

  console.log("[personnel-moves:backfill] replaying keyPersonnel…");
  const rosterRows = await db
    .select({
      profileUrl: keyPersonnel.linkedinProfileUrl,
      companyId: keyPersonnel.companyId,
      name: keyPersonnel.name,
      title: keyPersonnel.title,
      firstSeenAt: keyPersonnel.firstSeenAt,
      lastSeenAt: keyPersonnel.lastSeenAt,
      scrapeRunId: keyPersonnel.scrapeRunId,
    })
    .from(keyPersonnel)
    .all();
  let obsCount = 0;
  for (const r of rosterRows) {
    const profile = normaliseProfileUrl(r.profileUrl ?? "");
    if (!profile) continue;
    await db.insert(peopleObservations).values({
      linkedinProfileUrl: profile,
      companyId: r.companyId,
      name: r.name,
      headline: r.title,
      source: "roster",
      observedAt: r.firstSeenAt ?? r.lastSeenAt ?? new Date().toISOString(),
      scrapeRunId: r.scrapeRunId,
    });
    obsCount++;
  }

  console.log("[personnel-moves:backfill] replaying postEngagements…");
  const engRows = await db
    .select({
      profileUrl: postEngagements.engagerLinkedinUrl,
      name: postEngagements.engagerName,
      headline: postEngagements.engagerHeadline,
      scrapedAt: postEngagements.scrapedAt,
      scrapeRunId: postEngagements.scrapeRunId,
    })
    .from(postEngagements)
    .all();
  for (const e of engRows) {
    const profile = normaliseProfileUrl(e.profileUrl ?? "");
    if (!profile) continue;
    const companyId = await resolveEmployerFromHeadline(e.headline);
    if (!companyId) continue;
    await db.insert(peopleObservations).values({
      linkedinProfileUrl: profile,
      companyId,
      name: e.name,
      headline: e.headline,
      source: "engagement",
      observedAt: e.scrapedAt ?? new Date().toISOString(),
      scrapeRunId: e.scrapeRunId,
    });
    obsCount++;
  }
  // Touch sql to satisfy lint when not otherwise referenced
  void sql;

  console.log(
    `[personnel-moves:backfill] ${obsCount} observations; running detect…`,
  );
  const moves = await detectMoves(runId);
  return { observations: obsCount, moves };
}

// ── Helper for the dashboard: pull the move history of a single profile ───
export async function profileHistory(profile: string) {
  const norm = normaliseProfileUrl(profile);
  return db
    .select({
      observedAt: peopleObservations.observedAt,
      source: peopleObservations.source,
      headline: peopleObservations.headline,
      companyId: peopleObservations.companyId,
    })
    .from(peopleObservations)
    .where(eq(peopleObservations.linkedinProfileUrl, norm))
    .orderBy(desc(peopleObservations.observedAt))
    .all();
}
