import { db } from "@/db";
import {
  companies,
  companyPosts,
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
      generationConfig: { maxOutputTokens: 800, temperature: 0.3 },
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

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(posts: PostForSummary[], companyNames: string[]): string {
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

  if (sections.length === 0) return "NO_INTERESTING_POSTS";

  return `
You are a cybersecurity market analyst. Below are recent LinkedIn posts from tracked companies: ${tracked}.

Summarize ONLY the key business events: partnerships, product launches, funding, notable technology news, and awards/recognition.
Skip generic marketing, event recaps, or promotional posts with no substance.
Be concise and factual. Use bullet points grouped by theme. If something is a new integration or partnership, name both parties.
Don't mention people joining the company.
Write in a professional tone, as if briefing a CISO or investor.

POSTS:
${sections.join("\n")}

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

Only include sections that have actual content. Start bullets with the company name in **bold**.
If there is nothing interesting to report, reply with: "No significant events this week."
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
  const posts = await collectInterestingPosts(7);

  if (posts.length === 0) {
    const msg = "No significant events detected this week. Run a scrape to collect fresh data.";
    if (latestRun) {
      await db
        .update(scrapeRuns)
        .set({ aiSummary: msg, aiSummaryGeneratedAt: new Date().toISOString() })
        .where(eq(scrapeRuns.id, latestRun.id));
    }
    return msg;
  }

  const prompt = buildPrompt(posts, companyNames);
  const summary = await callGemini(prompt);

  if (latestRun) {
    await db
      .update(scrapeRuns)
      .set({ aiSummary: summary, aiSummaryGeneratedAt: new Date().toISOString() })
      .where(eq(scrapeRuns.id, latestRun.id));
  }

  return summary;
}
