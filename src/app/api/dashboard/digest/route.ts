import { NextResponse } from "next/server";
import { generateWeeklyDigest } from "@/lib/analysis/digest-generator";

export async function GET() {
  const digest = await generateWeeklyDigest();
  return NextResponse.json(digest);
}
