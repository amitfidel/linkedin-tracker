export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { runPipeline, runGartnerOnly } from "@/lib/pipeline/orchestrator";

let isRunning = false;

export async function POST(req: NextRequest) {
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
