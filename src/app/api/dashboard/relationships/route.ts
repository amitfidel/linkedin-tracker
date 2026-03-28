export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { buildRelationshipGraph } from "@/lib/analysis/relationship-map";

export async function GET() {
  const graph = await buildRelationshipGraph();
  return NextResponse.json(graph);
}
