export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { scrapeRuns } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * PATCH /api/scrape/{id}/acknowledge
 *
 * Marks a scrape run's errors as seen by the user. Sets errorsAcknowledgedAt
 * to the current timestamp so the error badge on the dashboard stops showing.
 */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runId = parseInt(id);
  if (isNaN(runId)) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const [updated] = await db
    .update(scrapeRuns)
    .set({ errorsAcknowledgedAt: new Date().toISOString() })
    .where(eq(scrapeRuns.id, runId))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Scrape run not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, errorsAcknowledgedAt: updated.errorsAcknowledgedAt });
}
