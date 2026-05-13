/**
 * Daily lightweight watch — runs Mon–Fri mornings.
 *
 * Trimmed runPipeline():
 *   1. Posts (local Playwright) for tracked vendors, limited to last 48h
 *   2. Engagers on competitor posts <48h old
 *   3. Cross-reference into clientInteractions (incl. personnel moves)
 *   4. Dispatch high-strength signals to Slack (if SLACK_WEBHOOK_URL set)
 *   5. Re-sync Obsidian vault so notes reflect fresh edges
 *
 * Skips companies / jobs / full Gartner / AI summary / weekly email — those
 * stay on the Monday 11am full pipeline.
 */
import { db } from "@/db";
import {
  companies,
  companyPosts,
  scrapeRuns,
} from "@/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import { scrapeCompanyPostsLocal } from "../linkedin/posts-scraper";
import { transformPost } from "./transformers";
import { scrapeEngagers } from "../linkedin/engagers-scraper";
import {
  persistEngagements,
  recordEngagementInteractions,
  buildClientRoster,
  scanMentions,
} from "../analysis/client-watch";
import {
  recordPeopleObservations,
  detectMoves,
  invalidateAliasCache,
} from "../analysis/personnel-moves";
import { dispatchSlackAlerts } from "../notify/slack";
import { syncToObsidian } from "../obsidian/sync";
import { like } from "drizzle-orm";

const POSTS_WINDOW_HOURS = 48;

export async function runDailyWatch(): Promise<{
  runId: number;
  postsIngested: number;
  engagementsScraped: number;
  signalsCreated: number;
  alertsSent: number;
}> {
  const [run] = await db
    .insert(scrapeRuns)
    .values({
      triggerType: "manual",
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .returning();
  const runId = run.id;
  console.log(`[daily-watch] run #${runId} started`);

  const competitorCompanies = await db
    .select()
    .from(companies)
    .where(and(eq(companies.category, "competitor"), eq(companies.isActive, true)))
    .all();

  if (competitorCompanies.length === 0) {
    console.log("[daily-watch] no competitor companies — nothing to watch");
    await db
      .update(scrapeRuns)
      .set({ status: "completed", completedAt: new Date().toISOString() })
      .where(eq(scrapeRuns.id, runId));
    return {
      runId,
      postsIngested: 0,
      engagementsScraped: 0,
      signalsCreated: 0,
      alertsSent: 0,
    };
  }

  const competitorIds = competitorCompanies.map((c) => c.id);
  const cutoff = new Date(
    Date.now() - POSTS_WINDOW_HOURS * 3600_000,
  ).toISOString();

  // ── 1. Posts (light) ─────────────────────────────────────────────────────
  let postsIngested = 0;
  try {
    const competitorUrls = competitorCompanies.map((c) => c.linkedinUrl);
    const postsResult = await scrapeCompanyPostsLocal(competitorUrls);
    console.log(`[daily-watch] scraped ${postsResult.data.length} posts`);

    const companyByUrl = new Map(
      competitorCompanies.map((c) => [
        c.linkedinUrl.toLowerCase().replace(/\/$/, ""),
        c,
      ]),
    );
    for (const raw of postsResult.data) {
      // Match author_url → company
      const normalized = (raw.author_url ?? "")
        .toLowerCase()
        .replace(/\/$/, "");
      let company = companyByUrl.get(normalized);
      if (!company) {
        for (const [key, c] of companyByUrl) {
          if (normalized.includes(key) || key.includes(normalized)) {
            company = c;
            break;
          }
        }
      }
      if (!company) continue;

      const transformed = transformPost(raw, company.id);
      if (!transformed.linkedinPostId) continue;

      // Activity-id dedup
      const activityId = /activity[:-](\d{10,})/.exec(
        transformed.linkedinPostId,
      )?.[1];
      const existing = activityId
        ? await db
            .select({ id: companyPosts.id })
            .from(companyPosts)
            .where(
              and(
                eq(companyPosts.companyId, company.id),
                like(companyPosts.linkedinPostId, `%${activityId}%`),
              ),
            )
            .get()
        : null;

      if (!existing) {
        await db
          .insert(companyPosts)
          .values({ ...transformed, scrapeRunId: runId });
        postsIngested++;
      } else {
        await db
          .update(companyPosts)
          .set({
            likesCount: transformed.likesCount,
            commentsCount: transformed.commentsCount,
            sharesCount: transformed.sharesCount,
          })
          .where(eq(companyPosts.id, existing.id));
      }
    }
  } catch (e) {
    console.error(
      "[daily-watch] posts step failed:",
      e instanceof Error ? e.message : e,
    );
  }
  console.log(`[daily-watch] ${postsIngested} new posts`);

  // ── 2. Engagers on competitor posts <48h old ─────────────────────────────
  let engagementsScraped = 0;
  let signalsCreated = 0;
  try {
    const recentPosts = await db
      .select({
        postId: companyPosts.id,
        postUrl: companyPosts.linkedinPostId,
        companyId: companyPosts.companyId,
      })
      .from(companyPosts)
      .where(
        and(
          inArray(companyPosts.companyId, competitorIds),
          gte(companyPosts.postedAt, cutoff),
        ),
      )
      .all();

    const postCompetitorMap = new Map<number, number>();
    const urns: string[] = [];
    for (const p of recentPosts) {
      const m = /activity[:-](\d{10,})/.exec(p.postUrl ?? "");
      if (!m) continue;
      urns.push(`urn:li:activity:${m[1]}`);
      postCompetitorMap.set(p.postId, p.companyId);
    }

    if (urns.length > 0) {
      console.log(`[daily-watch] scraping engagers on ${urns.length} posts`);
      const eng = await scrapeEngagers(urns, { maxLikesPerPost: 80 });
      engagementsScraped = eng.data.length;

      const inserted = await persistEngagements(eng.data, runId);
      const roster = await buildClientRoster();
      signalsCreated += await recordEngagementInteractions({
        engagements: inserted,
        postCompetitorMap,
        roster,
        runId,
      });
    }

    // Mention scan (cheap) + observation/move detection
    signalsCreated +=
      (await scanMentions({
        runId,
        sourceCategory: "client",
        targetCategory: "competitor",
      })) +
      (await scanMentions({
        runId,
        sourceCategory: "competitor",
        targetCategory: "client",
      }));

    invalidateAliasCache();
    const obsCount = await recordPeopleObservations(runId);
    console.log(`[daily-watch] ${obsCount} observations`);
    signalsCreated += await detectMoves(runId);
  } catch (e) {
    console.error(
      "[daily-watch] cross-reference failed:",
      e instanceof Error ? e.message : e,
    );
  }
  console.log(`[daily-watch] ${signalsCreated} new signals`);

  // ── 3. Slack alerts ──────────────────────────────────────────────────────
  let alertsSent = 0;
  try {
    alertsSent = await dispatchSlackAlerts();
    console.log(`[daily-watch] ${alertsSent} signals pushed to Slack`);
  } catch (e) {
    console.error(
      "[daily-watch] slack failed:",
      e instanceof Error ? e.message : e,
    );
  }

  // ── 4. Obsidian sync ─────────────────────────────────────────────────────
  try {
    await syncToObsidian();
  } catch (e) {
    console.warn(
      "[daily-watch] obsidian sync failed:",
      e instanceof Error ? e.message : e,
    );
  }

  await db
    .update(scrapeRuns)
    .set({
      status: "completed",
      completedAt: new Date().toISOString(),
      companiesCount: competitorCompanies.length,
    })
    .where(eq(scrapeRuns.id, runId));

  console.log(`[daily-watch] done`);
  return { runId, postsIngested, engagementsScraped, signalsCreated, alertsSent };
}
