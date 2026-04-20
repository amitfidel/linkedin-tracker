import { db } from "@/db";
import {
  companies,
  companyPosts,
  gartnerInsights,
  scrapeRuns,
} from "@/db/schema";
import { eq, gte, desc, and } from "drizzle-orm";
import {
  categorizePost,
  categorizeBatchLLM,
  type PostCategory,
} from "./post-categorizer";

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const INTERESTING_CATEGORIES: PostCategory[] = [
  "partnership", "launch", "funding", "technology", "award",
];

// ── Gemini REST client (avoids SDK versioning issues) ─────────────────────────

async function callGemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2400, temperature: 0.3 },
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Gemini API error ${res.status}`);
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "Summary unavailable.";
}

// ── Post collection ───────────────────────────────────────────────────────────

interface PostForSummary {
  companyName: string;
  content: string;
  category: PostCategory;
  postedAt: string | null;
  likes: number;
}

async function collectInterestingPosts(sinceDays = 7): Promise<PostForSummary[]> {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();

  const rows = await db
    .select({
      companyName: companies.name,
      content: companyPosts.content,
      postedAt: companyPosts.postedAt,
      likesCount: companyPosts.likesCount,
    })
    .from(companyPosts)
    .innerJoin(companies, eq(companyPosts.companyId, companies.id))
    .where(and(gte(companyPosts.scrapedAt, since), eq(companies.isActive, true)))
    .orderBy(desc(companyPosts.scrapedAt));

  const enriched = rows.map((r, i) => ({
    id: `p${i}`,
    companyName: r.companyName,
    content: r.content ?? "",
    category: categorizePost(r.content ?? ""),
    postedAt: r.postedAt,
    likes: r.likesCount ?? 0,
  }));

  // Groq upgrade path: re-classify substantive posts the keyword matcher
  // labeled "general". One batched call; silently no-ops if GROQ_API_KEY absent.
  const candidates = enriched.filter(
    (p) => p.category === "general" && p.content.length > 120,
  );
  if (candidates.length > 0) {
    const llmResults = await categorizeBatchLLM(
      candidates.map((p) => ({ id: p.id, text: p.content })),
    );
    for (const p of enriched) {
      const reclassified = llmResults.get(p.id);
      if (reclassified && reclassified !== "general") {
        p.category = reclassified;
      }
    }
  }

  return enriched
    .filter(
      (p) => INTERESTING_CATEGORIES.includes(p.category) && p.content.length > 30,
    )
    .map(({ id: _id, ...rest }) => rest);
}

// ── Gartner insight collection ────────────────────────────────────────────────

interface GartnerInsightForSummary {
  companyName: string;
  type: "like" | "dislike";
  text: string;
}

async function collectGartnerInsights(): Promise<GartnerInsightForSummary[]> {
  // Only include insights scraped in the last 7 days
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const rows = await db
    .select({
      companyName: companies.name,
      type: gartnerInsights.type,
      text: gartnerInsights.text,
    })
    .from(gartnerInsights)
    .innerJoin(companies, eq(gartnerInsights.companyId, companies.id))
    .where(and(eq(companies.isActive, true), gte(gartnerInsights.scrapedAt, since)))
    .orderBy(desc(gartnerInsights.scrapedAt));

  // Keep up to 3 likes and 3 dislikes per company
  const counts: Record<string, { like: number; dislike: number }> = {};
  const result: GartnerInsightForSummary[] = [];
  for (const r of rows) {
    const key = r.companyName;
    if (!counts[key]) counts[key] = { like: 0, dislike: 0 };
    const t = r.type as "like" | "dislike";
    if (counts[key][t] < 3) {
      counts[key][t]++;
      result.push({ companyName: r.companyName, type: t, text: r.text ?? "" });
    }
  }
  return result;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(
  posts: PostForSummary[],
  companyNames: string[],
  gartnerData: GartnerInsightForSummary[]
): string {
  const tracked = companyNames.join(", ");

  const grouped: Partial<Record<PostCategory, PostForSummary[]>> = {};
  for (const p of posts) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category]!.push(p);
  }

  const sections: string[] = [];
  for (const [cat, catPosts] of Object.entries(grouped)) {
    if (!catPosts?.length) continue;
    sections.push(`[${cat.toUpperCase()}]`);
    for (const p of catPosts.slice(0, 6)) {
      const snippet = p.content.replace(/\s+/g, " ").trim().slice(0, 400);
      sections.push(`- ${p.companyName}: "${snippet}"`);
    }
    sections.push("");
  }

  if (sections.length === 0 && gartnerData.length === 0) return "NO_INTERESTING_POSTS";

  // Build Gartner section (only this week's new insights)
  let gartnerSection = "[GARTNER CUSTOMER REVIEWS]\nNo new Gartner insights this week.";
  if (gartnerData.length > 0) {
    const byCompany: Record<string, { likes: string[]; dislikes: string[] }> = {};
    for (const g of gartnerData) {
      if (!byCompany[g.companyName]) byCompany[g.companyName] = { likes: [], dislikes: [] };
      if (g.type === "like") byCompany[g.companyName].likes.push(g.text.slice(0, 300));
      else byCompany[g.companyName].dislikes.push(g.text.slice(0, 300));
    }
    const lines: string[] = ["[GARTNER CUSTOMER REVIEWS - NEW THIS WEEK]"];
    for (const [company, { likes, dislikes }] of Object.entries(byCompany)) {
      if (likes.length) lines.push(`${company} LIKES:\n${likes.map((t) => `  + ${t}`).join("\n")}`);
      if (dislikes.length) lines.push(`${company} DISLIKES:\n${dislikes.map((t) => `  - ${t}`).join("\n")}`);
    }
    gartnerSection = lines.join("\n");
  }

  const postsSection = sections.length > 0 ? `LINKEDIN POSTS:\n${sections.join("\n")}` : "";

  return `
You are a cybersecurity market analyst. You have data on tracked companies: ${tracked}.

Your job is to surface actionable competitive intelligence — not to describe content, but to derive what it MEANS for a buyer, competitor, or investor.

${postsSection}

${gartnerSection}

OUTPUT FORMAT — follow EXACTLY. Each labeled line must start with the literal label shown (uppercase, colon), on its own line. DO NOT drop, rename, or replace the labels with natural headings — they are parsed by a downstream program that looks for the literal strings "HEADLINE:", "SUBHEAD:", "LEDE:", "PULL_QUOTE:", "ATTRIBUTION:".

CONCRETE EXAMPLE of the expected output shape (content is illustrative only):

HEADLINE: Identity security quietly ate the week
SUBHEAD: SailPoint, Okta, and CyberArk all shipped material news while the SIEM crowd went dark.
LEDE: Three funding rounds and two platform launches reshaped the identity category. If last week was about plumbing, this week was about the platform.
## 🚀 Product Launches & Features
- **SailPoint** launched Atlas Agents — autonomous identity governance.
  _Why it matters: First real agentic play in IGA; pressures Okta's roadmap._
PULL_QUOTE: Sepio is directly attacking the weaknesses in Network Access Control.
ATTRIBUTION: Product Launches & Features — §02

NOW PRODUCE YOUR OUTPUT using the same literal labels:

HEADLINE: <one sentence, 6–10 words, competitive-intel tone, no period>
SUBHEAD: <one sentence, 12–20 words, expands the headline>
LEDE: <two or three sentences, punchy and opinionated; sets up the week — what shifted, what it tells us about the market. No bullets.>


## 🤝 Partnerships & Integrations
- **Company** did X with Y.
  _Why it matters: one-line opinionated take._

## 🚀 Product Launches & Features
- **Company** shipped Z.
  _Why it matters: one-line opinionated take._

## 💰 Funding & Business
- **Company** raised $N.
  _Why it matters: one-line opinionated take._

## 🔬 Technology & Research
- **Company** published research on X.
  _Why it matters: one-line opinionated take._

## 🏆 Recognition & Awards
- **Company** named to X.
  _Why it matters: one-line opinionated take._

## 🎯 Customer Intelligence (Gartner)
- **Company** insight from customer reviews.
  _Why it matters: one-line opinionated take._

PULL_QUOTE: <one sentence, the sharpest competitive-intel insight of the week, no surrounding quotes>

ATTRIBUTION: <short section reference, e.g. "Customer Intelligence — §04" or "Funding — §03">

Rules:
- Start each bullet with the company in **bold**, followed by the event summary.
- The "_Why it matters: …_" subline is REQUIRED on every bullet and MUST be on its own line directly under the bullet (indented 2 spaces), wrapped in single underscores.
- Only include sections that have real content. Skip empty ones entirely — do not emit empty section headings.
- Customer Intelligence is based on NEW Gartner reviews from this week only. Derive insights, not summaries. Be opinionated about competitive strengths and weaknesses per vendor. If there are no new Gartner insights, omit the section entirely.
- If there are no events at all, emit just HEADLINE + SUBHEAD + LEDE (with "A quiet week." framing) and no category sections, but still emit PULL_QUOTE + ATTRIBUTION.
- Write as if briefing a CISO or investor. Concise. Factual. Opinionated where the data supports it.
`.trim();
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateAISummary(forceRefresh = false): Promise<string> {
  // Return cached summary from the latest completed run if available
  const latestRun = await db
    .select()
    .from(scrapeRuns)
    .where(eq(scrapeRuns.status, "completed"))
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(1)
    .get();

  if (!forceRefresh && latestRun?.aiSummary) {
    return latestRun.aiSummary;
  }

  const allCompanies = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.isActive, true));

  const companyNames = allCompanies.map((c) => c.name);
  const [posts, gartnerData] = await Promise.all([
    collectInterestingPosts(7),
    collectGartnerInsights(),
  ]);

  if (posts.length === 0 && gartnerData.length === 0) {
    const msg = "No significant events detected this week. Run a scrape to collect fresh data.";
    if (latestRun) {
      await db
        .update(scrapeRuns)
        .set({ aiSummary: msg, aiSummaryGeneratedAt: new Date().toISOString() })
        .where(eq(scrapeRuns.id, latestRun.id));
    }
    return msg;
  }

  const prompt = buildPrompt(posts, companyNames, gartnerData);
  const summary = await callGemini(prompt);

  if (latestRun) {
    await db
      .update(scrapeRuns)
      .set({ aiSummary: summary, aiSummaryGeneratedAt: new Date().toISOString() })
      .where(eq(scrapeRuns.id, latestRun.id));
  }

  return summary;
}
