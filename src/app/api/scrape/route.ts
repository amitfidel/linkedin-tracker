export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { runPipeline, runGartnerOnly } from "@/lib/pipeline/orchestrator";
import { db } from "@/db";
import { scrapeRuns } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";

let isRunning = false;

export async function POST(req: NextRequest) {
  // Clean up any "running" records older than 30 minutes (server restart / crash)
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await db
    .update(scrapeRuns)
    .set({ status: "failed", completedAt: new Date().toISOString(), errorMessage: "Interrupted (server restart)" })
    .where(and(eq(scrapeRuns.status, "running"), lt(scrapeRuns.startedAt, thirtyMinutesAgo)));

  if (isRunning) {
    return NextResponse.json(
      { error: "A scrape is already in progress" },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const gartnerOnly = body?.mode === "gartner";

  isRunning = true;

  const runner = gartnerOnly ? runGartnerOnly : () => runPipeline("manual");

  runner()
    .then((result) => {
      console.log("Scrape completed:", result);
    })
    .catch((err) => {
      console.error("Scrape failed:", err);
    })
    .finally(() => {
      isRunning = false;
    });

  return NextResponse.json({ message: "Scrape started", status: "running", mode: gartnerOnly ? "gartner" : "full" });
}
