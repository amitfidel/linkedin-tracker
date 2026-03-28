export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { scrapeRuns } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const runs = await db
    .select()
    .from(scrapeRuns)
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(20);

  return NextResponse.json(runs);
}
