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
