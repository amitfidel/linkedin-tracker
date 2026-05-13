/**
 * Targeted refresh — scrapes employee rosters for every active company
 * (clients + tracked vendors), re-attributes ALL existing engagements
 * against the new roster, then re-syncs the Obsidian vault.
 *
 *   npx tsx scripts/refresh-rosters.ts
 *
 * Cheaper than a full weekly scrape — no posts/jobs/Gartner/engager re-scrape.
 */
import "dotenv/config";
import { db } from "../src/db";
import {
  companies,
  keyPersonnel,
  scrapeRuns,
} from "../src/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { scrapePeople } from "../src/lib/apify/scraper";
import { transformPerson } from "../src/lib/pipeline/transformers";
import { detectPersonnelChanges } from "../src/lib/pipeline/diff-detector";
import { reattributeAllEngagements } from "../src/lib/analysis/client-watch";
import { syncToObsidian } from "../src/lib/obsidian/sync";

async function main() {
  const [run] = await db
    .insert(scrapeRuns)
    .values({
      triggerType: "manual",
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .returning();
  const runId = run.id;
  console.log(`[refresh] run #${runId} started`);

  const active = await db
    .select()
    .from(companies)
    .where(
      and(
        eq(companies.isActive, true),
        inArray(companies.category, ["self", "competitor", "client"]),
      ),
    )
    .all();
  const scrapeable = active.filter(
    (c) => !c.linkedinUrl.includes("/search/results/"),
  );
  console.log(
    `[refresh] ${active.length} active companies, ${scrapeable.length} scrapeable`,
  );

  try {
    const result = await scrapePeople(scrapeable.map((c) => c.linkedinUrl));
    console.log(`[refresh] apify returned ${result.data.length} people`);

    const findByName = (name?: string) => {
      if (!name) return undefined;
      const nl = name.toLowerCase();
      return active.find((c) => {
        const cl = c.name.toLowerCase();
        return cl === nl || cl.includes(nl) || nl.includes(cl);
      });
    };

    const peopleByCompany = new Map<number, Array<ReturnType<typeof transformPerson>>>();
    for (const raw of result.data) {
      const c = findByName(raw.company);
      if (!c) continue;
      const t = transformPerson(raw, c.id);
      if (!peopleByCompany.has(c.id)) peopleByCompany.set(c.id, []);
      peopleByCompany.get(c.id)!.push(t);
    }

    for (const [companyId, people] of peopleByCompany) {
      await detectPersonnelChanges(companyId, people, runId);
      for (const person of people) {
        const existing = await db
          .select()
          .from(keyPersonnel)
          .where(
            and(
              eq(keyPersonnel.companyId, companyId),
              eq(keyPersonnel.name, person.name),
            ),
          )
          .get();
        if (!existing) {
          await db
            .insert(keyPersonnel)
            .values({ ...person, isCurrent: true, scrapeRunId: runId });
        } else {
          await db
            .update(keyPersonnel)
            .set({
              title: person.title ?? existing.title,
              isCurrent: true,
              lastSeenAt: new Date().toISOString(),
              scrapeRunId: runId,
            })
            .where(eq(keyPersonnel.id, existing.id));
        }
      }
    }
    console.log(
      `[refresh] inserted/refreshed people for ${peopleByCompany.size} companies`,
    );
  } catch (e) {
    console.error(
      "[refresh] people scrape failed:",
      e instanceof Error ? e.message : e,
    );
  }

  const added = await reattributeAllEngagements(runId);
  console.log(`[refresh] new client interactions: ${added}`);

  await syncToObsidian().catch((e) => {
    console.warn(
      "[refresh] obsidian sync failed:",
      e instanceof Error ? e.message : e,
    );
  });

  await db
    .update(scrapeRuns)
    .set({
      status: "completed",
      completedAt: new Date().toISOString(),
      companiesCount: active.length,
    })
    .where(eq(scrapeRuns.id, runId));

  console.log(`[refresh] done`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
