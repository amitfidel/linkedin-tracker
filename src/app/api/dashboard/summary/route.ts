import { NextResponse } from "next/server";
import { generateAISummary } from "@/lib/analysis/ai-summarizer";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";

  try {
    const summary = await generateAISummary(forceRefresh);
    return NextResponse.json({ summary, generatedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate summary";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
