export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline/orchestrator";

let isRunning = false;

export async function POST() {
  if (isRunning) {
    return NextResponse.json(
      { error: "A scrape is already in progress" },
      { status: 409 }
    );
  }

  isRunning = true;

  // Start pipeline in background, don't await
  runPipeline("manual")
    .then((result) => {
      console.log("Scrape completed:", result);
    })
    .catch((err) => {
      console.error("Scrape failed:", err);
    })
    .finally(() => {
      isRunning = false;
    });

  return NextResponse.json({ message: "Scrape started", status: "running" });
}
