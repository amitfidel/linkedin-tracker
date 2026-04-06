import { db } from "@/db";
import {
  companies,
  companyPosts,
  gartnerInsights,
  scrapeRuns,
} from "@/db/schema";
import { eq, gte, desc, and } from "drizzle-orm";
import { categorizePost, type PostCategory } from "./post-categorizer";

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
      generationConfig: { maxOutputTokens: 1200, temperature: 0.3 },
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

  return rows
    .map((r) => ({
      companyName: r.companyName,
      content: r.content ?? "",
      category: categorizePost(r.content ?? ""),
      postedAt: r.postedAt,
      likes: r.likesCount ?? 0,
    }))
    .filter((p) => INTERESTING_CATEGORIES.includes(p.category) && p.content.length > 30);
}

// ── Gartner insight collection ────────────────────────────────────────────────

interface GartnerInsightForSummary {
  companyName: string;
  type: "like" | "dislike";
  text: string;
}

async function collectGartnerInsights(): Promise<GartnerInsightForSummary[]> {
  const rows = await db
    .select({
      companyName: companies.name,
      type: gartnerInsights.type,
      text: gartnerInsights.text,
    })
    .from(gartnerInsights)
    .innerJoin(companies, eq(gartnerInsights.companyId, companies.id))
    .where(eq(companies.isActive, true))
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

  // Build Gartner section
  let gartnerSection = "";
  if (gartnerData.length > 0) {
    const byCompany: Record<string, { likes: string[]; dislikes: string[] }> = {};
    for (const g of gartnerData) {
      if (!byCompany[g.companyName]) byCompany[g.companyName] = { likes: [], dislikes: [] };
      if (g.type === "like") byCompany[g.companyName].likes.push(g.text.slice(0, 300));
      else byCompany[g.companyName].dislikes.push(g.text.slice(0, 300));
    }
    const lines: string[] = ["[GARTNER CUSTOMER REVIEWS]"];
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

FORMAT your response exactly like this (use markdown):
## 🤝 Partnerships & Integrations
- bullet
## 🚀 Product Launches & Features
- bullet
## 💰 Funding & Business
- bullet
## 🔬 Technology & Research
- bullet
## 🏆 Recognition & Awards
- bullet
## 🎯 Customer Intelligence (Gartner)
- bullet

Rules:
- LinkedIn sections: summarize key business events only. Skip generic marketing. Name both parties in partnerships.
- Customer Intelligence section: based on Gartner reviews, derive INSIGHTS — not summaries. E.g. "Armis leads in OT/IoT asset visibility but has high operational overhead", not just "customers like visibility". Identify patterns across likes/dislikes. Call out competitive strengths and weaknesses per vendor. Be opinionated.
- Only include sections that have actual content.
- Start bullets with the company name in **bold**.
- Write as if briefing a CISO or investor. Be concise and factual.
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
