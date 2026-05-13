/**
 * Obsidian sync — exports the SQL state of CyberTracker (companies +
 * employees + client↔competitor interactions) to a folder on disk that
 * lives as its own Obsidian vault (intentionally NOT the same vault as
 * any other notes you keep).
 *
 * Bipartite graph shape:
 *   - One note per company (client / competitor / self).
 *   - Employees listed inside the note as plain text (NOT separate notes —
 *     they shouldn't appear as nodes in graph view).
 *   - Interactions surface as `[[Competitor]]` wikilinks inside each client
 *     note. Those wikilinks become the edges in the graph.
 *   - Tag groups (#cybertracker/client vs #cybertracker/competitor) so you
 *     can colour the two clusters in Obsidian's Graph view → Groups.
 *
 * Writes via the filesystem — no Obsidian REST API plugin required.
 * Set OBSIDIAN_VAULT_PATH in .env to override the default location.
 */
import { promises as fs } from "fs";
import { spawn } from "child_process";
import path from "path";
import { db } from "@/db";
import {
  companies,
  keyPersonnel,
  clientInteractions,
} from "@/db/schema";
import { inArray, desc } from "drizzle-orm";
import { computeLeadScores } from "../analysis/lead-score";

const DEFAULT_VAULT_PATH =
  "C:\\Users\\amitf\\Documents\\Projects\\personal progects\\client tracker";
const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH ?? DEFAULT_VAULT_PATH;

function safeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function writeNote(relPath: string, content: string): Promise<void> {
  const abs = path.join(VAULT_PATH, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

function frontmatter(
  category: string,
  c: { linkedinUrl: string; industry: string | null; website: string | null },
  score?: number,
): string {
  const tag = `cybertracker/${category}`;
  const lines = [
    "---",
    `tags: [${tag}]`,
    `category: ${category}`,
    `linkedin: ${c.linkedinUrl}`,
  ];
  if (typeof score === "number") lines.push(`leadScore: ${score}`);
  if (c.industry) lines.push(`industry: ${c.industry}`);
  if (c.website) lines.push(`website: ${c.website}`);
  lines.push("---", "");
  return lines.join("\n");
}

function scoreBanner(score: number, topCompetitor: string | null): string {
  if (score <= 0) return "";
  const flame = score >= 100 ? "🔥🔥" : score >= 60 ? "🔥" : "•";
  const tail = topCompetitor ? ` · top vs **${topCompetitor}**` : "";
  return `> ${flame} **Warmth score: ${score}** (30-day, weighted)${tail}\n\n`;
}

function describe(d: string | null | undefined): string {
  if (!d) return "";
  const flat = d.replace(/\s+/g, " ").trim();
  return flat.length > 600 ? flat.slice(0, 600) + "…" : flat;
}

function employeesBlock(
  people: Array<{
    name: string;
    title: string | null;
    linkedinProfileUrl: string | null;
  }>,
): string {
  if (people.length === 0) {
    return "## Employees on file (0)\n\n_(roster will populate after the next weekly scrape)_\n";
  }
  const lines = [`## Employees on file (${people.length})`, ""];
  for (const p of people) {
    const title = p.title ? ` — ${p.title}` : "";
    const link = p.linkedinProfileUrl
      ? ` · [profile](${p.linkedinProfileUrl})`
      : "";
    lines.push(`- **${p.name}**${title}${link}`);
  }
  return lines.join("\n") + "\n";
}

interface InteractionRow {
  signalType: string;
  summary: string | null;
  engagerName: string | null;
  matchedBy: string | null;
  competitorName: string;
  detectedAt: string | null;
  sentiment?: string | null;
}

function sentimentTag(s: string | null | undefined): string {
  if (s === "positive") return " 🚨 _endorses competitor_";
  if (s === "negative") return " 💡 _sepio opening_";
  return "";
}

function clientInteractionsBlock(items: InteractionRow[]): string {
  if (items.length === 0) {
    return "## Interactions with competitors\n\n_(none yet)_\n";
  }
  const byCompetitor = new Map<string, InteractionRow[]>();
  for (const it of items) {
    const arr = byCompetitor.get(it.competitorName) ?? [];
    arr.push(it);
    byCompetitor.set(it.competitorName, arr);
  }

  const lines = ["## Interactions with competitors", ""];
  for (const [competitor, events] of byCompetitor) {
    lines.push(
      `### [[${competitor}]] · ${events.length} event${events.length === 1 ? "" : "s"}`,
    );
    lines.push("");
    for (const e of events.slice(0, 15)) {
      const date = e.detectedAt?.slice(0, 10) ?? "";
      const tag = e.matchedBy ? ` _(via ${e.matchedBy})_` : "";
      const sentTag = sentimentTag(e.sentiment);
      lines.push(`- \`${date}\` ${e.summary ?? ""}${tag}${sentTag}`);
    }
    if (events.length > 15)
      lines.push(`- …and ${events.length - 15} more`);
    lines.push("");
  }
  return lines.join("\n");
}

function competitorInteractionsBlock(items: InteractionRow[]): string {
  if (items.length === 0) {
    return "## Interactions with our clients\n\n_(none yet)_\n";
  }
  const lines = ["## Interactions with our clients", ""];
  for (const e of items.slice(0, 30)) {
    const date = e.detectedAt?.slice(0, 10) ?? "";
    lines.push(`- \`${date}\` ${e.summary ?? ""}`);
  }
  if (items.length > 30) lines.push(`- …and ${items.length - 30} more`);
  return lines.join("\n") + "\n";
}

// ── Main export ──────────────────────────────────────────────────────────────
export async function syncToObsidian(): Promise<void> {
  console.log(`[obsidian] vault: ${VAULT_PATH}`);
  await fs.mkdir(VAULT_PATH, { recursive: true });

  const all = await db
    .select()
    .from(companies)
    .where(inArray(companies.category, ["self", "competitor", "client"]))
    .all();

  const allPeople = await db
    .select()
    .from(keyPersonnel)
    .where(
      inArray(
        keyPersonnel.companyId,
        all.map((c) => c.id),
      ),
    )
    .all();

  // Per-client warmth scores for the 30-day window
  const scores = await computeLeadScores({ sinceDays: 30 });
  const scoreByClient = new Map(scores.map((s) => [s.clientCompanyId, s]));

  const allInteractions = await db
    .select({
      id: clientInteractions.id,
      clientCompanyId: clientInteractions.clientCompanyId,
      competitorCompanyId: clientInteractions.competitorCompanyId,
      signalType: clientInteractions.signalType,
      summary: clientInteractions.summary,
      engagerName: clientInteractions.engagerName,
      matchedBy: clientInteractions.matchedBy,
      detectedAt: clientInteractions.detectedAt,
      sentiment: clientInteractions.sentiment,
    })
    .from(clientInteractions)
    .orderBy(desc(clientInteractions.detectedAt))
    .all();

  const idToName = new Map(all.map((c) => [c.id, c.name]));

  // Wipe any stale company notes from a prior run so deleted companies
  // don't linger. We only delete files in this folder that match our naming
  // — never touch user-created files or other folders.
  const existing = await fs
    .readdir(VAULT_PATH)
    .catch(() => [] as string[]);
  const wantNames = new Set(
    all.map((c) => `${safeFilename(c.name)}.md`),
  );
  wantNames.add("README.md");
  for (const f of existing) {
    if (f.endsWith(".md") && !wantNames.has(f)) {
      await fs.unlink(path.join(VAULT_PATH, f)).catch(() => {});
    }
  }

  let count = 0;
  for (const c of all) {
    const fname = safeFilename(c.name);
    const filepath = `${fname}.md`;

    const employees = allPeople
      .filter((p) => p.companyId === c.id)
      .map((p) => ({
        name: p.name,
        title: p.title,
        linkedinProfileUrl: p.linkedinProfileUrl,
      }));

    let interactionsSection = "";
    if (c.category === "client") {
      const events: InteractionRow[] = allInteractions
        .filter((i) => i.clientCompanyId === c.id)
        .map((i) => ({
          signalType: i.signalType,
          summary: i.summary,
          engagerName: i.engagerName,
          matchedBy: i.matchedBy,
          competitorName: idToName.get(i.competitorCompanyId) ?? "?",
          detectedAt: i.detectedAt,
          sentiment: i.sentiment,
        }));
      interactionsSection = clientInteractionsBlock(events);
    } else if (c.category === "competitor") {
      const events: InteractionRow[] = allInteractions
        .filter((i) => i.competitorCompanyId === c.id)
        .map((i) => ({
          signalType: i.signalType,
          summary: i.summary,
          engagerName: i.engagerName,
          matchedBy: i.matchedBy,
          competitorName: idToName.get(i.clientCompanyId) ?? "?",
          detectedAt: i.detectedAt,
          sentiment: i.sentiment,
        }));
      interactionsSection = competitorInteractionsBlock(events);
    } else {
      interactionsSection = "";
    }

    const scoreRow = c.category === "client" ? scoreByClient.get(c.id) : null;
    const banner = scoreRow
      ? scoreBanner(scoreRow.score, scoreRow.topCompetitor)
      : "";

    const md = [
      frontmatter(c.category, c, scoreRow?.score),
      `# ${c.name}`,
      "",
      banner +
        (describe(c.description) ? `> ${describe(c.description)}` : ""),
      "",
      `[LinkedIn](${c.linkedinUrl})${c.website ? ` · [${c.website.replace(/^https?:\/\//, "")}](${c.website})` : ""}`,
      "",
      employeesBlock(employees),
      "",
      interactionsSection,
    ].join("\n");

    await writeNote(filepath, md);
    console.log(`  ✓ ${filepath}`);
    count++;
  }

  // README
  const readme = [
    "# CyberTracker — Obsidian view",
    "",
    "_Auto-generated from the CyberTracker SQL database. **Don't hand-edit notes here** — they get overwritten on each sync._",
    "",
    "This folder is a standalone Obsidian vault — open it as a separate vault in Obsidian (File → Open Vault → Open folder as vault).",
    "",
    "## Refresh",
    "",
    "From the linkedin-tracker project root:",
    "",
    "```",
    "npx tsx scripts/sync-obsidian.ts",
    "```",
    "",
    "## Bipartite graph view",
    "",
    "Open **Graph view → Filter icon → Groups** and add:",
    "",
    "| Group | Query | Suggested colour |",
    "|---|---|---|",
    "| Clients | `tag:#cybertracker/client` | green |",
    "| Competitors | `tag:#cybertracker/competitor` | orange |",
    "| Self | `tag:#cybertracker/self` | grey |",
    "",
    "Edges only form between clients and competitors when a client employee engages with a competitor post — that's your bipartite signal.",
  ].join("\n");
  await writeNote("README.md", readme);
  count++;

  console.log(`\nwrote ${count} notes to ${VAULT_PATH}`);

  // Optional: bring Obsidian forward to the vault we just synced.
  // Requires the "Command line interface" toggle in Obsidian settings.
  // Skipped silently in CI / headless contexts.
  if (process.env.OBSIDIAN_OPEN_AFTER_SYNC !== "0") {
    const vaultName = path.basename(VAULT_PATH);
    const url = `obsidian://open?vault=${encodeURIComponent(vaultName)}`;
    try {
      if (process.platform === "win32") {
        spawn("cmd", ["/c", "start", "", url], {
          detached: true,
          stdio: "ignore",
        }).unref();
      } else if (process.platform === "darwin") {
        spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
      }
      console.log(`[obsidian] opened vault "${vaultName}" in Obsidian`);
    } catch (e) {
      console.warn(
        `[obsidian] couldn't open vault automatically:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
}
