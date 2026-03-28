import { db } from "@/db";
import { keyPersonnel, personnelChanges } from "@/db/schema";
import { eq, and } from "drizzle-orm";

interface PersonEntry {
  companyId: number;
  name: string;
  title: string | null;
  linkedinProfileUrl: string | null;
}

export async function detectPersonnelChanges(
  companyId: number,
  currentPeople: PersonEntry[],
  scrapeRunId: number
) {
  // Get previously known current personnel for this company
  const previousPeople = await db
    .select()
    .from(keyPersonnel)
    .where(
      and(
        eq(keyPersonnel.companyId, companyId),
        eq(keyPersonnel.isCurrent, true)
      )
    );

  const changes: Array<{
    personId?: number;
    companyId: number;
    changeType: string;
    oldTitle?: string;
    newTitle?: string;
    personName: string;
    scrapeRunId: number;
  }> = [];

  // Build lookup maps
  const prevByName = new Map(previousPeople.map((p) => [p.name.toLowerCase(), p]));
  const currByName = new Map(currentPeople.map((p) => [p.name.toLowerCase(), p]));

  // Detect new hires
  for (const [nameLower, person] of currByName) {
    const prev = prevByName.get(nameLower);
    if (!prev) {
      changes.push({
        companyId,
        changeType: "joined",
        newTitle: person.title || undefined,
        personName: person.name,
        scrapeRunId,
      });
    } else if (prev.title && person.title && prev.title !== person.title) {
      // Title change
      changes.push({
        personId: prev.id,
        companyId,
        changeType: "title_change",
        oldTitle: prev.title,
        newTitle: person.title,
        personName: person.name,
        scrapeRunId,
      });
    }
  }

  // Detect departures
  for (const [nameLower, prev] of prevByName) {
    if (!currByName.has(nameLower)) {
      changes.push({
        personId: prev.id,
        companyId,
        changeType: "left",
        oldTitle: prev.title || undefined,
        personName: prev.name,
        scrapeRunId,
      });
      // Mark person as no longer current
      await db
        .update(keyPersonnel)
        .set({ isCurrent: false, lastSeenAt: new Date().toISOString() })
        .where(eq(keyPersonnel.id, prev.id));
    }
  }

  // Insert changes
  if (changes.length > 0) {
    await db.insert(personnelChanges).values(changes);
  }

  return changes;
}
