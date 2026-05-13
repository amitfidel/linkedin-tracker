export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  companies,
  keyPersonnel,
  clientInteractions,
} from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { computeLeadScores } from "@/lib/analysis/lead-score";

/**
 * GET /api/clients
 * Returns the list of imported clients with aggregated counts for the
 * dashboard list view: # employees in roster, # interactions this week,
 * # interactions all-time, latest interaction summary.
 */
export async function GET() {
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      linkedinUrl: companies.linkedinUrl,
      industry: companies.industry,
      logoUrl: companies.logoUrl,
      employeeCount: companies.employeeCount,
      isActive: companies.isActive,
    })
    .from(companies)
    .where(and(eq(companies.category, "client"), eq(companies.isActive, true)))
    .all();

  if (rows.length === 0) {
    return NextResponse.json({ clients: [] });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Lead scores (30-day window) — once, then merge per row
  const scores = await computeLeadScores({ sinceDays: 30 });
  const scoreMap = new Map(
    scores.map((s) => [s.clientCompanyId, s]),
  );

  // Aggregate counts in parallel
  const out = await Promise.all(
    rows.map(async (c) => {
      const rosterSize = await db
        .select({ n: sql<number>`count(*)` })
        .from(keyPersonnel)
        .where(eq(keyPersonnel.companyId, c.id))
        .get();

      const weekCount = await db
        .select({ n: sql<number>`count(*)` })
        .from(clientInteractions)
        .where(
          and(
            eq(clientInteractions.clientCompanyId, c.id),
            gte(clientInteractions.detectedAt, sevenDaysAgo),
          ),
        )
        .get();

      const totalCount = await db
        .select({ n: sql<number>`count(*)` })
        .from(clientInteractions)
        .where(eq(clientInteractions.clientCompanyId, c.id))
        .get();

      const latest = await db
        .select({
          summary: clientInteractions.summary,
          signalType: clientInteractions.signalType,
          detectedAt: clientInteractions.detectedAt,
        })
        .from(clientInteractions)
        .where(eq(clientInteractions.clientCompanyId, c.id))
        .orderBy(sql`detected_at DESC`)
        .limit(1)
        .get();

      const scoreRow = scoreMap.get(c.id);
      return {
        ...c,
        rosterSize: rosterSize?.n ?? 0,
        weekInteractions: weekCount?.n ?? 0,
        totalInteractions: totalCount?.n ?? 0,
        latestInteraction: latest ?? null,
        leadScore: scoreRow?.score ?? 0,
        topCompetitor: scoreRow?.topCompetitor ?? null,
      };
    }),
  );

  // Sort: hot accounts first, then alphabetic for the long tail of 0-score
  out.sort((a, b) => {
    if (b.leadScore !== a.leadScore) return b.leadScore - a.leadScore;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ clients: out });
}
