/**
 * Keyword-based post categorizer.
 * Assigns a single primary category to a LinkedIn post based on its text content.
 */

export type PostCategory =
  | "partnership"
  | "launch"
  | "funding"
  | "technology"
  | "award"
  | "event"
  | "hiring"
  | "general";

export const CATEGORY_META: Record<
  PostCategory,
  { label: string; emoji: string; color: string }
> = {
  partnership:  { label: "Partnership",     emoji: "🤝", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  launch:       { label: "Product Launch",  emoji: "🚀", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  funding:      { label: "Funding",         emoji: "💰", color: "bg-green-500/10 text-green-600 dark:text-green-400" },
  technology:   { label: "Technology",      emoji: "🔬", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  award:        { label: "Recognition",     emoji: "🏆", color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" },
  event:        { label: "Event",           emoji: "📅", color: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  hiring:       { label: "Hiring",          emoji: "👥", color: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
  general:      { label: "Update",          emoji: "📢", color: "bg-muted text-muted-foreground" },
};

// Higher-priority categories come first
const RULES: Array<{ category: PostCategory; keywords: string[] }> = [
  {
    category: "funding",
    keywords: [
      "funding", "raises", "raised", "series a", "series b", "series c", "series d",
      "investment", "investors", "valuation", "unicorn", "venture capital", "vc backed",
      "growth equity", "private equity",
    ],
  },
  {
    category: "partnership",
    keywords: [
      "partner", "partnership", "partnering", "partners with", "collaboration",
      "collaborate", "integration", "integrates with", "joins forces", "alliance",
      "ecosystem", "joint", "co-develop", "reseller", "channel partner",
    ],
  },
  {
    category: "launch",
    keywords: [
      "launch", "launches", "launched", "introducing", "introduce", "announcing",
      "announced", "new product", "new solution", "new platform", "new feature",
      "release", "released", "generally available", "ga today", "ship", "ships",
      "unveil", "unveiled",
    ],
  },
  {
    category: "award",
    keywords: [
      "award", "awarded", "named", "recognized", "recognition", "leader in",
      "gartner", "forrester", "magic quadrant", "idc", "frost", "best", "winner",
      "top company", "excellence", "accolade",
    ],
  },
  {
    category: "technology",
    keywords: [
      "research", "discovered", "vulnerability", "vulnerabilities", "threat",
      "cve-", "zero-day", "zero day", "malware", "ransomware", "exploit",
      "attack", "breach", "report", "study", "findings", "analysis", "ai", "machine learning",
      "artificial intelligence", "detection", "model", "algorithm",
    ],
  },
  {
    category: "event",
    keywords: [
      "conference", "summit", "webinar", "rsac", "rsa conference", "black hat",
      "def con", "event", "keynote", "booth", "join us", "register", "session",
      "panel", "speaking", "fireside",
    ],
  },
  {
    category: "hiring",
    keywords: [
      "hiring", "we're hiring", "job opening", "open role", "apply now",
      "careers", "join our team", "looking for", "now recruiting",
    ],
  },
];

export function categorizePost(text: string): PostCategory {
  if (!text) return "general";
  const lower = text.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.category;
    }
  }
  return "general";
}

// ── LLM batch re-classification via Groq ─────────────────────────────────────
// Upgrades posts the keyword matcher labels "general" to a more specific
// category when possible. One Groq call per batch regardless of post count.

import { callGroqJson, hasGroqKey } from "../llm/groq";

const VALID_CATEGORIES: PostCategory[] = [
  "partnership",
  "launch",
  "funding",
  "technology",
  "award",
  "event",
  "hiring",
  "general",
];

interface GroqCategorizeItem {
  id: string;
  text: string;
}

interface GroqCategorizeResult {
  results?: Array<{ id: string; category: string }>;
}

/**
 * Given a list of posts, returns a Map<id, category> for the ones Groq
 * successfully re-categorized. Silently returns an empty Map when
 * GROQ_API_KEY is not set or the call fails — callers should use this as
 * an enrichment layer on top of `categorizePost()`, not a replacement.
 */
export async function categorizeBatchLLM(
  items: GroqCategorizeItem[],
): Promise<Map<string, PostCategory>> {
  const out = new Map<string, PostCategory>();
  if (!hasGroqKey() || items.length === 0) return out;

  // Truncate each post to keep the prompt bounded
  const payload = items.map((it) => ({
    id: it.id,
    text: it.text.replace(/\s+/g, " ").trim().slice(0, 400),
  }));

  const prompt = `Classify each LinkedIn post from a cybersecurity vendor into exactly one category.

Categories: ${VALID_CATEGORIES.join(", ")}.

Category definitions:
- partnership: joint go-to-market, integration, alliance, channel/reseller
- launch: new product, feature release, GA, ship, unveil
- funding: raised capital, series round, valuation, IPO, acquisition of themselves
- technology: research output, threat report, vulnerability disclosure, novel tech/algorithm
- award: industry recognition, magic quadrant, leader designation, top-X list
- event: conference, webinar, booth, keynote, panel, fireside
- hiring: open roles, recruiting push, culture/team growth posts
- general: everything else (thought leadership, marketing fluff, generic updates)

Posts (JSON): ${JSON.stringify(payload)}

Return JSON: {"results": [{"id": "<id>", "category": "<category>"}, ...]}
Every input id must appear in results. Use "general" if genuinely unclear.`;

  try {
    const parsed = await callGroqJson<GroqCategorizeResult>(prompt, {
      temperature: 0.1,
      maxTokens: 1500,
    });
    if (!parsed?.results) return out;
    for (const r of parsed.results) {
      const cat = VALID_CATEGORIES.includes(r.category as PostCategory)
        ? (r.category as PostCategory)
        : "general";
      out.set(r.id, cat);
    }
  } catch (e) {
    console.warn(
      "[groq] batch categorize failed:",
      e instanceof Error ? e.message : e,
    );
  }

  return out;
}
