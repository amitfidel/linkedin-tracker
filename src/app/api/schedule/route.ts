import { NextResponse } from "next/server";
import { db } from "@/db";
import { scheduleConfig } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const config = await db.select().from(scheduleConfig).where(eq(scheduleConfig.id, 1)).get();
  return NextResponse.json(config || { cronExpression: "0 2 * * 1", isEnabled: true });
}

export async function POST(request: Request) {
  const body = await request.json();

  const existing = await db.select().from(scheduleConfig).where(eq(scheduleConfig.id, 1)).get();

  if (existing) {
    const [updated] = await db
      .update(scheduleConfig)
      .set({
        cronExpression: body.cronExpression || existing.cronExpression,
        isEnabled: body.isEnabled !== undefined ? body.isEnabled : existing.isEnabled,
      })
      .where(eq(scheduleConfig.id, 1))
      .returning();
    return NextResponse.json(updated);
  } else {
    const [created] = await db
      .insert(scheduleConfig)
      .values({
        id: 1,
        cronExpression: body.cronExpression || "0 2 * * 1",
        isEnabled: body.isEnabled !== undefined ? body.isEnabled : true,
      })
      .returning();
    return NextResponse.json(created);
  }
}
