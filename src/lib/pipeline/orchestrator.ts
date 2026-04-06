import { db } from "@/db";
import {
  companies,
  companySnapshots,
  companyPosts,
  jobListings,
  keyPersonnel,
  scrapeRuns,
  gartnerInsights,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  scrapeCompanies,
  scrapePosts,
  scrapeJobs,
  scrapePeople,
} from "../apify/scraper";
import {
  transformCompany,
  transformPost,
  transformJob,
  transformPerson,
} from "./transformers";
import { detectPersonnelChanges } from "./diff-detector";
import { generateAISummary } from "../analysis/ai-summarizer";
import { scrapeGartnerInsights, discoverGartnerUrl } from "../gartner/scraper";

async function sha256(text: string): Promise<string> {
  const crypto = await import("crypto");
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function runPipeline(triggerType: "manual" | "scheduled") {
  // Create scrape run record
  const [run] = await db
    .insert(scrapeRuns)
    .values({
      triggerType,
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .returning();

  const runId = run.id;
  let totalCredits = 0;
  const apifyRunIds: string[] = [];
  const stepErrors: string[] = [];

  try {
    // Get all active companies
    const activeCompanies = await db
      .select()
      .from(companies)
      .where(eq(companies.isActive, true));

    if (activeCompanies.length === 0) {
      await db
        .update(scrapeRuns)
        .set({
          status: "completed",
          completedAt: new Date().toISOString(),
          companiesCount: 0,
          stepErrors: JSON.stringify(["No active companies to scrape"]),
        })
        .where(eq(scrapeRuns.id, runId));
      return { runId, status: "completed", message: "No active companies to scrape" };
    }

    const companyUrls = activeCompanies.map((c) => c.linkedinUrl);

    // Build a map keyed by the normalized LinkedIn URL for fast lookups
    const companyUrlMap = new Map(
      activeCompanies.map((c) => [c.linkedinUrl.toLowerCase().replace(/\/$/, ""), c])
    );

    /** Match a raw result back to one of our tracked companies. */
    function findCompanyByUrl(url?: string) {
      if (!url) return undefined;
      const normalized = url.toLowerCase().replace(/\/$/, "");
      const exact = companyUrlMap.get(normalized);
      if (exact) return exact;
      // Partial match (handles trailing slashes, query params, etc.)
      for (const [key, company] of companyUrlMap) {
        if (normalized.includes(key) || key.includes(normalized)) return company;
      }
      return undefined;
    }

    function findCompanyByName(name?: string) {
      if (!name) return undefined;
      const nl = name.toLowerCase();
      return activeCompanies.find((c) => {
        const cl = c.name.toLowerCase();
        return cl === nl || cl.includes(nl) || nl.includes(cl);
      });
    }

    // ── Step 1: Company info ─────────────────────────────────────────────────
    try {
      const companyResult = await scrapeCompanies(companyUrls);
      apifyRunIds.push(companyResult.runId);
      totalCredits += companyResult.creditsUsed;

      for (const raw of companyResult.data) {
        const transformed = transformCompany(raw);
        const company = findCompanyByUrl(raw.url) ?? findCompanyByName(raw.name);
        if (!company) continue;

        await db
          .update(companies)
          .set({
            description: transformed.description ?? company.description,
            website: transformed.website ?? company.website,
            industry: transformed.industry ?? company.industry,
            employeeCount: transformed.employeeCount ?? company.employeeCount,
            specialties: transformed.specialties ?? company.specialties,
            headquarters: transformed.headquarters ?? company.headquarters,
            logoUrl: transformed.logoUrl ?? company.logoUrl,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(companies.id, company.id));

        await db.insert(companySnapshots).values({
          companyId: company.id,
          employeeCount: transformed.employeeCount,
          followerCount: transformed.followerCount,
          scrapeRunId: runId,
          rawData: JSON.stringify(raw),
        });
      }
    } catch (e) {
      const msg = `Company scrape: ${e instanceof Error ? e.message : String(e)}`;
      console.error(msg);
      stepErrors.push(msg);
    }

    // ── Step 2: Posts ────────────────────────────────────────────────────────
    try {
      const postsResult = await scrapePosts(companyUrls);
      apifyRunIds.push(postsResult.runId);
      totalCredits += postsResult.creditsUsed;

      for (const raw of postsResult.data) {
        // author_url is the company LinkedIn URL
        const company =
          findCompanyByUrl(raw.author_url) ?? findCompanyByName(raw.author);
        if (!company) continue;

        const transformed = transformPost(raw, company.id);
        if (!transformed.linkedinPostId) continue;

        const existing = await db
          .select({ id: companyPosts.id })
          .from(companyPosts)
          .where(eq(companyPosts.linkedinPostId, transformed.linkedinPostId))
          .get();

        if (!existing) {
          await db.insert(companyPosts).values({ ...transformed, scrapeRunId: runId });
        } else {
          // Refresh engagement counts
          await db
            .update(companyPosts)
            .set({
              likesCount: transformed.likesCount,
              commentsCount: transformed.commentsCount,
              sharesCount: transformed.sharesCount,
            })
            .where(eq(companyPosts.id, existing.id));
        }
      }
    } catch (e) {
      const msg = `Posts scrape: ${e instanceof Error ? e.message : String(e)}`;
      console.error(msg);
      stepErrors.push(msg);
    }

    // ── Step 3: Jobs (per company) ───────────────────────────────────────────
    try {
      const jobsResult = await scrapeJobs(activeCompanies);
      // runId may be comma-separated when multiple company runs happened
      if (jobsResult.runId) apifyRunIds.push(...jobsResult.runId.split(",").filter(Boolean));
      totalCredits += jobsResult.creditsUsed;

      const seenJobIds = new Map<number, Set<string>>();

      for (const raw of jobsResult.data) {
        const company =
          findCompanyByUrl(raw.company_url) ?? findCompanyByName(raw.company);
        if (!company) continue;

        const transformed = transformJob(raw, company.id);
        if (!transformed.linkedinJobId) continue;

        if (!seenJobIds.has(company.id)) seenJobIds.set(company.id, new Set());
        seenJobIds.get(company.id)!.add(transformed.linkedinJobId);

        const existing = await db
          .select({ id: jobListings.id })
          .from(jobListings)
          .where(eq(jobListings.linkedinJobId, transformed.linkedinJobId))
          .get();

        if (!existing) {
          await db.insert(jobListings).values({ ...transformed, scrapeRunId: runId });
        }
      }

      // Mark jobs no longer seen as inactive
      for (const company of activeCompanies) {
        const seen = seenJobIds.get(company.id) ?? new Set<string>();
        const activeJobs = await db
          .select()
          .from(jobListings)
          .where(and(eq(jobListings.companyId, company.id), eq(jobListings.isActive, true)));

        for (const job of activeJobs) {
          if (job.linkedinJobId && !seen.has(job.linkedinJobId)) {
            await db
              .update(jobListings)
              .set({ isActive: false, closedAt: new Date().toISOString() })
              .where(eq(jobListings.id, job.id));
          }
        }
      }
    } catch (e) {
      const msg = `Jobs scrape: ${e instanceof Error ? e.message : String(e)}`;
      console.error(msg);
      stepErrors.push(msg);
    }

    // ── Step 4: Employees ────────────────────────────────────────────────────
    try {
      const peopleResult = await scrapePeople(companyUrls);
      apifyRunIds.push(peopleResult.runId);
      totalCredits += peopleResult.creditsUsed;

      const peopleByCompany = new Map<number, Array<ReturnType<typeof transformPerson>>>();

      for (const raw of peopleResult.data) {
        // Match by `company` field (company name) since employee records don't carry the URL
        const company = findCompanyByName(raw.company);
        if (!company) continue;

        const transformed = transformPerson(raw, company.id);
        if (!peopleByCompany.has(company.id)) peopleByCompany.set(company.id, []);
        peopleByCompany.get(company.id)!.push(transformed);
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
                eq(keyPersonnel.name, person.name)
              )
            )
            .get();

          if (!existing) {
            await db.insert(keyPersonnel).values({ ...person, isCurrent: true, scrapeRunId: runId });
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
    } catch (e) {
      const msg = `Employees scrape: ${e instanceof Error ? e.message : String(e)}`;
      console.error(msg);
      stepErrors.push(msg);
    }

    // ── Step 4b: Auto-discover Gartner URLs for companies that don't have one ──
    for (const company of activeCompanies) {
      if (!company.gartnerUrl) {
        try {
          const discovered = await discoverGartnerUrl(company.name);
          if (discovered) {
            await db
              .update(companies)
              .set({ gartnerUrl: discovered, updatedAt: new Date().toISOString() })
              .where(eq(companies.id, company.id));
            // Update in-memory so Step 5 picks it up immediately
            company.gartnerUrl = discovered;
            console.log(`[Gartner] Auto-discovered URL for ${company.name}: ${discovered}`);
          }
        } catch (e) {
          console.warn(`[Gartner] Auto-discovery failed for ${company.name}:`, e instanceof Error ? e.message : e);
        }
      }
    }

    // ── Step 5: Gartner insights ─────────────────────────────────────────────
    const gartnerCompanies = activeCompanies.filter((c) => c.gartnerUrl);
    if (gartnerCompanies.length > 0) {
      for (const company of gartnerCompanies) {
        try {
          // Fetch already-scraped review URLs so the scraper can skip them
          const existingRows = await db
            .select({ reviewUrl: gartnerInsights.reviewUrl })
            .from(gartnerInsights)
            .where(eq(gartnerInsights.companyId, company.id));
          const existingReviewUrls = new Set(
            existingRows.map((r) => r.reviewUrl).filter(Boolean) as string[]
          );

          const insights = await scrapeGartnerInsights(company.gartnerUrl!, existingReviewUrls);
          let newCount = 0;
          for (const insight of insights) {
            const hash = await sha256(insight.text);
            // Dedup by reviewUrl first, then fall back to textHash
            const existingByUrl = insight.reviewUrl
              ? await db
                  .select({ id: gartnerInsights.id })
                  .from(gartnerInsights)
                  .where(
                    and(
                      eq(gartnerInsights.companyId, company.id),
                      eq(gartnerInsights.reviewUrl, insight.reviewUrl)
                    )
                  )
                  .get()
              : null;
            const existingByHash = existingByUrl
              ? null
              : await db
                  .select({ id: gartnerInsights.id })
                  .from(gartnerInsights)
                  .where(
                    and(
                      eq(gartnerInsights.companyId, company.id),
                      eq(gartnerInsights.textHash, hash)
                    )
                  )
                  .get();
            if (!existingByUrl && !existingByHash) {
              await db.insert(gartnerInsights).values({
                companyId: company.id,
                scrapeRunId: runId,
                type: insight.type,
                text: insight.text,
                textHash: hash,
                reviewUrl: insight.reviewUrl,
                reviewerRole: insight.reviewerRole,
                reviewerIndustry: insight.reviewerIndustry,
                scrapedAt: new Date().toISOString(),
              });
              newCount++;
            }
          }
          console.log(`[Gartner] ${company.name}: ${insights.length} total, ${newCount} new`);
        } catch (e) {
          const msg = `Gartner scrape (${company.name}): ${e instanceof Error ? e.message : String(e)}`;
          console.error(msg);
          stepErrors.push(msg);
        }
      }
    }

    // ── Finalize ─────────────────────────────────────────────────────────────
    await db
      .update(scrapeRuns)
      .set({
        status: "completed",
        completedAt: new Date().toISOString(),
        companiesCount: activeCompanies.length,
        apifyRunIds: JSON.stringify(apifyRunIds),
        creditsUsed: totalCredits,
        stepErrors: stepErrors.length > 0 ? JSON.stringify(stepErrors) : null,
      })
      .where(eq(scrapeRuns.id, runId));

    // ── Auto-generate AI summary (non-blocking — failure doesn't affect status) ─
    try {
      await generateAISummary(true); // force-refresh so summary reflects latest data
    } catch (e) {
      console.warn("AI summary generation failed (non-critical):", e instanceof Error ? e.message : e);
    }

    return {
      runId,
      status: "completed",
      companiesScraped: activeCompanies.length,
      creditsUsed: totalCredits,
      stepErrors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(scrapeRuns)
      .set({
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: message,
        apifyRunIds: JSON.stringify(apifyRunIds),
        creditsUsed: totalCredits,
        stepErrors: stepErrors.length > 0 ? JSON.stringify(stepErrors) : null,
      })
      .where(eq(scrapeRuns.id, runId));

    return { runId, status: "failed", error: message };
  }
}

export async function runGartnerOnly() {
  const [run] = await db
    .insert(scrapeRuns)
    .values({ triggerType: "manual", status: "running", startedAt: new Date().toISOString() })
    .returning();

  const runId = run.id;
  const stepErrors: string[] = [];

  try {
    const activeCompanies = await db.select().from(companies).where(eq(companies.isActive, true));
    const gartnerCompanies = activeCompanies.filter((c) => c.gartnerUrl);

    if (gartnerCompanies.length === 0) {
      await db.update(scrapeRuns).set({
        status: "completed",
        completedAt: new Date().toISOString(),
        companiesCount: 0,
        stepErrors: JSON.stringify(["No companies with Gartner URL configured"]),
      }).where(eq(scrapeRuns.id, runId));
      return { runId, status: "completed" };
    }

    for (const company of gartnerCompanies) {
      try {
        const existingRows = await db
          .select({ reviewUrl: gartnerInsights.reviewUrl })
          .from(gartnerInsights)
          .where(eq(gartnerInsights.companyId, company.id));
        const existingReviewUrls = new Set(
          existingRows.map((r) => r.reviewUrl).filter(Boolean) as string[]
        );

        const insights = await scrapeGartnerInsights(company.gartnerUrl!, existingReviewUrls);
        let newCount = 0;
        for (const insight of insights) {
          const hash = await sha256(insight.text);
          const existingByUrl = insight.reviewUrl
            ? await db.select({ id: gartnerInsights.id }).from(gartnerInsights)
                .where(and(eq(gartnerInsights.companyId, company.id), eq(gartnerInsights.reviewUrl, insight.reviewUrl)))
                .get()
            : null;
          const existingByHash = existingByUrl
            ? null
            : await db.select({ id: gartnerInsights.id }).from(gartnerInsights)
                .where(and(eq(gartnerInsights.companyId, company.id), eq(gartnerInsights.textHash, hash)))
                .get();
          if (!existingByUrl && !existingByHash) {
            await db.insert(gartnerInsights).values({
              companyId: company.id,
              scrapeRunId: runId,
              type: insight.type,
              text: insight.text,
              textHash: hash,
              reviewUrl: insight.reviewUrl,
              reviewerRole: insight.reviewerRole,
              reviewerIndustry: insight.reviewerIndustry,
              scrapedAt: new Date().toISOString(),
            });
            newCount++;
          }
        }
        console.log(`[Gartner] ${company.name}: ${insights.length} total, ${newCount} new`);
      } catch (e) {
        const msg = `Gartner scrape (${company.name}): ${e instanceof Error ? e.message : String(e)}`;
        console.error(msg);
        stepErrors.push(msg);
      }
    }

    await db.update(scrapeRuns).set({
      status: stepErrors.length > 0 ? "completed" : "completed",
      completedAt: new Date().toISOString(),
      companiesCount: gartnerCompanies.length,
      creditsUsed: 0,
      stepErrors: stepErrors.length > 0 ? JSON.stringify(stepErrors) : null,
    }).where(eq(scrapeRuns.id, runId));

    return { runId, status: "completed", stepErrors };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db.update(scrapeRuns).set({
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: message,
    }).where(eq(scrapeRuns.id, runId));
    return { runId, status: "failed", error: message };
  }
}
