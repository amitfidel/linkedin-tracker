import { NextResponse } from "next/server";
import { getHiringTrends } from "@/lib/analysis/hiring-trends";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30");
  const trends = await getHiringTrends(days);
  return NextResponse.json(trends);
}
