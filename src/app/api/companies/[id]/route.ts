import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  companies,
  companyPosts,
  jobListings,
  keyPersonnel,
  companySnapshots,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const companyId = parseInt(id);

  const company = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .get();

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const recentPosts = await db
    .select()
    .from(companyPosts)
    .where(eq(companyPosts.companyId, companyId))
    .orderBy(desc(companyPosts.postedAt))
    .limit(20);

  const activeJobs = await db
    .select()
    .from(jobListings)
    .where(eq(jobListings.companyId, companyId))
    .orderBy(desc(jobListings.scrapedAt))
    .limit(50);

  const personnel = await db
    .select()
    .from(keyPersonnel)
    .where(eq(keyPersonnel.companyId, companyId))
    .orderBy(desc(keyPersonnel.lastSeenAt));

  const snapshots = await db
    .select()
    .from(companySnapshots)
    .where(eq(companySnapshots.companyId, companyId))
    .orderBy(desc(companySnapshots.scrapedAt))
    .limit(12);

  return NextResponse.json({
    company,
    recentPosts,
    activeJobs,
    personnel,
    snapshots,
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const companyId = parseInt(id);
  const body = await request.json();

  const [updated] = await db
    .update(companies)
    .set({
      ...body,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(companies.id, companyId))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const companyId = parseInt(id);

  const [deleted] = await db
    .delete(companies)
    .where(eq(companies.id, companyId))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
