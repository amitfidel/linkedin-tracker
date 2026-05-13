/**
 * Client-watch matching layer.
 *
 * Given a fresh batch of post engagements (who liked/commented/reposted what)
 * and the active client roster (companies WHERE category='client' + their
 * keyPersonnel), produce clientInteractions rows.
 *
 * Three matchers, in priority order:
 *   1. profile_url — engager's LinkedIn URL matches a known client employee
 *   2. headline    — engager's headline mentions a client company by name
 *   3. (no match)  — engagement stays in post_engagements but no signal fires
 *
 * Also: mention scan (client mentions competitor in post, or reverse) and
 * personnel-move detection (left a client this run, joined a competitor).
 */
import { db } from "@/db";
import {
  companies,
  companyPosts,
  clientInteractions,
  keyPersonnel,
  personnelChanges,
  postEngagements,
  type NewPostEngagement,
  type NewClientInteraction,
} from "@/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { RawEngagement } from "../linkedin/engagers-scraper";

// ── URL normalisation — handles the variants LinkedIn shows ──────────────────
export function normaliseProfileUrl(url: string | null | undefined): string {
  if (!url) return "";
  let u = url.trim().toLowerCase();
  u = u.split("?")[0].split("#")[0];
  u = u.replace(/\/$/, "");
  u = u.replace(/^http:/, "https:");
  return u;
}

// ── Persist scraped engagements ──────────────────────────────────────────────
/**
 * Insert engagements into post_engagements, mapping URNs back to post IDs.
 * Returns the engagements that were genuinely inserted (skips dedup hits).
 */
export async function persistEngagements(
  engagements: RawEngagement[],
  runId: number,
): Promise<Array<RawEngagement & { postId: number }>> {
  if (engagements.length === 0) return [];

  // Map URN → postId for posts referenced by this batch.
  const urns = Array.from(new Set(engagements.map((e) => e.urn)));
  const urnToPostId = new Map<string, number>();
  for (const urn of urns) {
    const id = urn.split(":").pop();
    if (!id) continue;
    // company_posts.linkedinPostId may use either slug-form or urn-form;
    // both embed the activity id we just extracted.
    const row = await db
      .select({ id: companyPosts.id, url: companyPosts.linkedinPostId })
      .from(companyPosts)
      .all();
    for (const p of row) {
      if ((p.url ?? "").includes(id)) {
        urnToPostId.set(urn, p.id);
        break;
      }
    }
  }

  const inserted: Array<RawEngagement & { postId: number }> = [];

  for (const e of engagements) {
    const postId = urnToPostId.get(e.urn);
    if (!postId) continue;

    const profile = normaliseProfileUrl(e.engagerLinkedinUrl);

    // Dedup: same engager + same engagement type on the same post is one row.
    const existing = await db
      .select({ id: postEngagements.id })
      .from(postEngagements)
      .where(
        and(
          eq(postEngagements.postId, postId),
          eq(postEngagements.engagerLinkedinUrl, profile),
          eq(postEngagements.engagementType, e.engagementType),
        ),
      )
      .get();
    if (existing) continue;

    const row: NewPostEngagement = {
      postId,
      engagerName: e.engagerName,
      engagerLinkedinUrl: profile,
      engagerHeadline: e.engagerHeadline ?? null,
      engagementType: e.engagementType,
      commentText: e.commentText ?? null,
      engagedAt: e.engagedAt ?? null,
      scrapeRunId: runId,
    };
    await db.insert(postEngagements).values(row);
    inserted.push({ ...e, postId });
  }
  return inserted;
}

// ── Build the client roster used for matching ────────────────────────────────
export interface ClientRoster {
  // Map<normalised profile URL, { clientCompanyId, clientName }>
  byProfileUrl: Map<string, { clientCompanyId: number; clientName: string }>;
  // Array of { name, aliases, clientCompanyId } for headline scanning
  byName: Array<{
    clientCompanyId: number;
    name: string;
    aliases: string[];
  }>;
}

/**
 * Build the lookup structures used by attributeEngagement(). Pulls all
 * `category='client'` companies and their keyPersonnel rosters in one go.
 */
export async function buildClientRoster(): Promise<ClientRoster> {
  const clients = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.category, "client"))
    .all();

  const byProfileUrl = new Map<
    string,
    { clientCompanyId: number; clientName: string }
  >();
  const byName: Array<{
    clientCompanyId: number;
    name: string;
    aliases: string[];
  }> = [];

  if (clients.length === 0) return { byProfileUrl, byName };

  const clientIds = clients.map((c) => c.id);
  const people = await db
    .select({
      companyId: keyPersonnel.companyId,
      profileUrl: keyPersonnel.linkedinProfileUrl,
    })
    .from(keyPersonnel)
    .where(inArray(keyPersonnel.companyId, clientIds))
    .all();

  const idToName = new Map(clients.map((c) => [c.id, c.name]));
  for (const p of people) {
    const key = normaliseProfileUrl(p.profileUrl);
    if (!key) continue;
    byProfileUrl.set(key, {
      clientCompanyId: p.companyId,
      clientName: idToName.get(p.companyId) ?? "",
    });
  }

  for (const c of clients) {
    const lower = c.name.toLowerCase();
    const aliases = Array.from(
      new Set(
        [
          lower,
          lower.replace(/[.,]/g, ""),
          lower.replace(/\s+(inc|llc|ltd|corp|corporation|co|gmbh)\.?$/i, ""),
        ].filter(Boolean),
      ),
    );
    byName.push({ clientCompanyId: c.id, name: c.name, aliases });
  }

  return { byProfileUrl, byName };
}

// ── Per-engagement attribution ───────────────────────────────────────────────
export interface AttributionResult {
  clientCompanyId: number;
  clientName: string;
  matchedBy: "profile_url" | "headline";
}

export function attributeEngagement(
  engagement: { engagerLinkedinUrl: string; engagerHeadline?: string },
  roster: ClientRoster,
): AttributionResult | null {
  // 1. profile_url
  const key = normaliseProfileUrl(engagement.engagerLinkedinUrl);
  const urlHit = roster.byProfileUrl.get(key);
  if (urlHit) {
    return {
      clientCompanyId: urlHit.clientCompanyId,
      clientName: urlHit.clientName,
      matchedBy: "profile_url",
    };
  }

  // 2. headline contains client name (or alias)
  const headline = (engagement.engagerHeadline ?? "").toLowerCase();
  if (!headline) return null;
  for (const c of roster.byName) {
    for (const alias of c.aliases) {
      if (alias.length < 3) continue; // avoid trivial matches
      if (headline.includes(alias)) {
        return {
          clientCompanyId: c.clientCompanyId,
          clientName: c.name,
          matchedBy: "headline",
        };
      }
    }
  }
  return null;
}

// ── Persist client interactions for a batch of attributed engagements ───────
export async function recordEngagementInteractions(args: {
  engagements: Array<RawEngagement & { postId: number }>;
  postCompetitorMap: Map<number, number>; // postId → competitorCompanyId
  roster: ClientRoster;
  runId: number;
}): Promise<number> {
  const { engagements, postCompetitorMap, roster, runId } = args;
  let count = 0;
  for (const e of engagements) {
    const competitorCompanyId = postCompetitorMap.get(e.postId);
    if (!competitorCompanyId) continue;
    const attr = attributeEngagement(e, roster);
    if (!attr) continue;

    const summary =
      e.engagementType === "comment"
        ? `${e.engagerName} (${e.engagerHeadline ?? "?"}) commented: "${(e.commentText ?? "").slice(0, 180)}"`
        : `${e.engagerName} (${e.engagerHeadline ?? "?"}) ${e.engagementType === "repost" ? "reposted" : "liked"} a competitor post`;

    const row: NewClientInteraction = {
      clientCompanyId: attr.clientCompanyId,
      competitorCompanyId,
      signalType: "post_engagement",
      postId: e.postId,
      engagerName: e.engagerName,
      engagerProfileUrl: normaliseProfileUrl(e.engagerLinkedinUrl),
      summary,
      matchedBy: attr.matchedBy,
      scrapeRunId: runId,
    };
    await db.insert(clientInteractions).values(row);
    count++;
    console.log(
      `[client-watch] match via ${e.urn}: ${e.engagerName} → ${attr.clientName} via ${attr.matchedBy}`,
    );
  }
  return count;
}

// ── Mention scanning ─────────────────────────────────────────────────────────
/**
 * For posts from companies in `sourceCategory`, scan content for any company
 * name in `targetCategory`. Emits one clientInteractions row per (post, target).
 * Only runs against posts inserted in this run (filter via scrapeRunId).
 */
export async function scanMentions(args: {
  runId: number;
  /** 'client' (look for competitor names in client posts) or 'competitor' (look for client names in competitor posts) */
  sourceCategory: "client" | "competitor";
  targetCategory: "client" | "competitor";
}): Promise<number> {
  const { runId, sourceCategory, targetCategory } = args;

  const sourcePosts = await db
    .select({
      postId: companyPosts.id,
      companyId: companyPosts.companyId,
      content: companyPosts.content,
    })
    .from(companyPosts)
    .innerJoin(companies, eq(companyPosts.companyId, companies.id))
    .where(
      and(
        eq(companyPosts.scrapeRunId, runId),
        eq(companies.category, sourceCategory),
      ),
    )
    .all();
  if (sourcePosts.length === 0) return 0;

  const targets = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.category, targetCategory))
    .all();
  if (targets.length === 0) return 0;

  let count = 0;
  for (const post of sourcePosts) {
    const lower = (post.content ?? "").toLowerCase();
    if (!lower) continue;
    for (const t of targets) {
      const needle = t.name.toLowerCase();
      if (needle.length < 3) continue;
      if (!lower.includes(needle)) continue;

      const clientCompanyId =
        sourceCategory === "client" ? post.companyId : t.id;
      const competitorCompanyId =
        sourceCategory === "competitor" ? post.companyId : t.id;
      const dir =
        sourceCategory === "client" ? "mentioned competitor" : "was mentioned by competitor";
      const summary = `Post ${dir} "${t.name}"`;

      const row: NewClientInteraction = {
        clientCompanyId,
        competitorCompanyId,
        signalType: "post_mention",
        postId: post.postId,
        summary,
        matchedBy: null,
        scrapeRunId: runId,
      };
      await db.insert(clientInteractions).values(row);
      count++;
    }
  }
  return count;
}

// ── Personnel move detection ────────────────────────────────────────────────
/**
 * Find people who left a `client` company AND joined a `competitor` company
 * (or reverse) in this scrape run. Matches by case-folded name.
 */
export async function scanPersonnelMoves(runId: number): Promise<number> {
  const recentChanges = await db
    .select({
      id: personnelChanges.id,
      personId: personnelChanges.personId,
      companyId: personnelChanges.companyId,
      changeType: personnelChanges.changeType,
      personName: personnelChanges.personName,
      category: companies.category,
    })
    .from(personnelChanges)
    .innerJoin(companies, eq(personnelChanges.companyId, companies.id))
    .where(
      and(
        eq(personnelChanges.scrapeRunId, runId),
        inArray(personnelChanges.changeType, ["joined", "left"]),
      ),
    )
    .all();
  if (recentChanges.length === 0) return 0;

  // Index "left" and "joined" by lowercase name
  type Change = (typeof recentChanges)[number];
  const leftBy = new Map<string, Change[]>();
  const joinedBy = new Map<string, Change[]>();
  for (const ch of recentChanges) {
    const key = (ch.personName ?? "").trim().toLowerCase();
    if (!key) continue;
    if (ch.changeType === "left") {
      (leftBy.get(key) ?? leftBy.set(key, []).get(key)!).push(ch);
    } else if (ch.changeType === "joined") {
      (joinedBy.get(key) ?? joinedBy.set(key, []).get(key)!).push(ch);
    }
  }

  let count = 0;
  for (const [name, leftList] of leftBy) {
    const joinedList = joinedBy.get(name);
    if (!joinedList) continue;
    for (const left of leftList) {
      for (const joined of joinedList) {
        // Care only about client ↔ competitor pairings
        const validPair =
          (left.category === "client" && joined.category === "competitor") ||
          (left.category === "competitor" && joined.category === "client");
        if (!validPair) continue;

        const clientCompanyId =
          left.category === "client" ? left.companyId : joined.companyId;
        const competitorCompanyId =
          left.category === "competitor" ? left.companyId : joined.companyId;
        const direction =
          left.category === "client" ? "left client → joined competitor" : "left competitor → joined client";

        const row: NewClientInteraction = {
          clientCompanyId,
          competitorCompanyId,
          signalType: "personnel_move",
          personnelChangeId: joined.id,
          engagerName: left.personName,
          summary: `${left.personName ?? "Someone"} — ${direction}`,
          matchedBy: null,
          scrapeRunId: runId,
        };
        await db.insert(clientInteractions).values(row);
        count++;
        console.log(`[client-watch] personnel move: ${row.summary}`);
      }
    }
  }
  return count;
}

// ── Re-attribute existing engagements against a freshly-built roster ────────
/**
 * Scan every row in post_engagements (regardless of when it was inserted)
 * and produce missing clientInteractions rows for any engager that now
 * matches a client (via profile URL or headline). Idempotent — skips
 * existing (postId, clientCompanyId, engagerProfileUrl) triples.
 *
 * Useful after importing a new client list or after refreshing employee
 * rosters: lets old engagements suddenly light up without re-scraping
 * engagers from LinkedIn.
 */
export async function reattributeAllEngagements(runId: number): Promise<number> {
  const roster = await buildClientRoster();
  console.log(
    `[client-watch:reattribute] roster: ${roster.byProfileUrl.size} profiles, ${roster.byName.length} client names`,
  );
  if (roster.byProfileUrl.size === 0 && roster.byName.length === 0) {
    console.log("[client-watch:reattribute] empty roster — nothing to match");
    return 0;
  }

  // Pull all engagements with their post's competitorCompanyId
  const rows = await db
    .select({
      id: postEngagements.id,
      postId: postEngagements.postId,
      engagerName: postEngagements.engagerName,
      engagerLinkedinUrl: postEngagements.engagerLinkedinUrl,
      engagerHeadline: postEngagements.engagerHeadline,
      engagementType: postEngagements.engagementType,
      commentText: postEngagements.commentText,
      competitorCompanyId: companyPosts.companyId,
    })
    .from(postEngagements)
    .innerJoin(companyPosts, eq(postEngagements.postId, companyPosts.id))
    .innerJoin(companies, eq(companyPosts.companyId, companies.id))
    .where(eq(companies.category, "competitor"))
    .all();

  console.log(
    `[client-watch:reattribute] scanning ${rows.length} engagements`,
  );

  let inserted = 0;
  for (const e of rows) {
    const attr = attributeEngagement(
      {
        engagerLinkedinUrl: e.engagerLinkedinUrl ?? "",
        engagerHeadline: e.engagerHeadline ?? undefined,
      },
      roster,
    );
    if (!attr) continue;

    // Dedup: don't insert if we already have this (post, client, profile) signal
    const existing = await db
      .select({ id: clientInteractions.id })
      .from(clientInteractions)
      .where(
        and(
          eq(clientInteractions.clientCompanyId, attr.clientCompanyId),
          eq(clientInteractions.postId, e.postId),
          eq(
            clientInteractions.engagerProfileUrl,
            normaliseProfileUrl(e.engagerLinkedinUrl ?? ""),
          ),
        ),
      )
      .get();
    if (existing) continue;

    const summary =
      e.engagementType === "comment"
        ? `${e.engagerName ?? "?"} (${e.engagerHeadline ?? "?"}) commented: "${(e.commentText ?? "").slice(0, 180)}"`
        : `${e.engagerName ?? "?"} (${e.engagerHeadline ?? "?"}) ${e.engagementType === "repost" ? "reposted" : "liked"} a competitor post`;

    await db.insert(clientInteractions).values({
      clientCompanyId: attr.clientCompanyId,
      competitorCompanyId: e.competitorCompanyId,
      signalType: "post_engagement",
      postId: e.postId,
      engagerName: e.engagerName,
      engagerProfileUrl: normaliseProfileUrl(e.engagerLinkedinUrl ?? ""),
      summary,
      matchedBy: attr.matchedBy,
      scrapeRunId: runId,
    });
    inserted++;
    console.log(
      `[client-watch:reattribute] match: ${e.engagerName} → ${attr.clientName} via ${attr.matchedBy}`,
    );
  }
  return inserted;
}

// ── Aggregate query for dashboard + email ────────────────────────────────────
/**
 * Pull recent client interactions ranked by signal strength + recency.
 * Strength order: personnel_move > post_engagement (comment) > post_engagement (other) > post_mention.
 */
export async function recentClientInteractions(opts: {
  sinceDays?: number;
  limit?: number;
}) {
  const sinceDays = opts.sinceDays ?? 7;
  const limit = opts.limit ?? 100;
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();

  // Pull with joins for the names of the two companies + post snippet
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
      detectedAt: clientInteractions.detectedAt,
    })
    .from(clientInteractions)
    .where(gte(clientInteractions.detectedAt, since))
    .all();

  const idToName = new Map<number, string>();
  const allIds = new Set<number>();
  for (const r of rows) {
    allIds.add(r.clientCompanyId);
    allIds.add(r.competitorCompanyId);
  }
  if (allIds.size) {
    const names = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(inArray(companies.id, Array.from(allIds)))
      .all();
    for (const n of names) idToName.set(n.id, n.name);
  }

  const enriched = rows.map((r) => ({
    ...r,
    clientName: idToName.get(r.clientCompanyId) ?? "?",
    competitorName: idToName.get(r.competitorCompanyId) ?? "?",
  }));

  // Rank
  function strength(r: (typeof enriched)[number]): number {
    if (r.signalType === "personnel_move") return 100;
    if (r.signalType === "post_engagement") {
      if (r.summary?.startsWith(`${r.engagerName ?? ""} (`)) {
        // Comment summaries include the quote
        if (r.summary.includes(' commented: "')) return 80;
        if (r.summary.includes(" reposted")) return 60;
        return 40; // like
      }
      return 40;
    }
    if (r.signalType === "post_mention") return 30;
    return 10;
  }
  enriched.sort((a, b) => {
    const ds = strength(b) - strength(a);
    if (ds !== 0) return ds;
    return (b.detectedAt ?? "").localeCompare(a.detectedAt ?? "");
  });

  return enriched.slice(0, limit);
}
