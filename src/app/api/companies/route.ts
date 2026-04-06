export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const allCompanies = await db.select().from(companies).orderBy(companies.name);
  return NextResponse.json(allCompanies);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { name, linkedinUrl } = body;

  if (!name || !linkedinUrl) {
    return NextResponse.json(
      { error: "name and linkedinUrl are required" },
      { status: 400 }
    );
  }

  // Normalize URL
  let url = linkedinUrl.trim();
  if (!url.startsWith("http")) url = `https://${url}`;
  url = url.replace(/\/$/, "");

  // Check for duplicates
  const existing = await db
    .select()
    .from(companies)
    .where(eq(companies.linkedinUrl, url))
    .get();

  if (existing) {
    return NextResponse.json(
      { error: "Company with this LinkedIn URL already exists" },
      { status: 409 }
    );
  }

  // Normalize Gartner URL if provided
  let gartnerUrl: string | null = null;
  const rawGartner = body.gartnerUrl?.trim() as string | undefined;
  if (rawGartner) {
    const cleaned = rawGartner.replace(/\/$/, "");
    gartnerUrl = cleaned.startsWith("http") ? cleaned : `https://${cleaned}`;
  }

  const [newCompany] = await db
    .insert(companies)
    .values({
      name: name.trim(),
      linkedinUrl: url,
      industry: body.industry || null,
      website: body.website || null,
      gartnerUrl,
    })
    .returning();

  return NextResponse.json(newCompany, { status: 201 });
}
