import { NextResponse } from "next/server";
import { db } from "@/db";
import { personnelChanges, companies } from "@/db/schema";
import { eq, desc, gte } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "90");
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const changes = await db
    .select({
      id: personnelChanges.id,
      companyName: companies.name,
      companyId: personnelChanges.companyId,
      changeType: personnelChanges.changeType,
      personName: personnelChanges.personName,
      oldTitle: personnelChanges.oldTitle,
      newTitle: personnelChanges.newTitle,
      detectedAt: personnelChanges.detectedAt,
    })
    .from(personnelChanges)
    .innerJoin(companies, eq(personnelChanges.companyId, companies.id))
    .where(gte(personnelChanges.detectedAt, since))
    .orderBy(desc(personnelChanges.detectedAt));

  return NextResponse.json(changes);
}
