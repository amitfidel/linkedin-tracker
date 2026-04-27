/**
 * Renders the weekly digest email as email-safe HTML (table-based layout,
 * inline styles, web-safe font stacks). Based on the V2 "Dispatch" design —
 * oversized serif masthead, hero material-events number + headline, lede,
 * sections with per-item tag/company/headline/take, pull quote, CTA, footer.
 */

// ── Design tokens (match V2 in the design file) ──────────────────────────────
const BG = "#0d0d0e";
const BG_ALT = "#111113";
const HAIR = "#1c1c1e";
const INK_LOUD = "#faf7ee";
const INK = "#ebe7dd";
const INK_MUTED = "#9a9688";
const INK_DIM = "#6a665c";
const INK_FADE = "#4a463c";
const ACCENT = "#c8ff3f"; // V2 default accent

const SERIF = `'Charter','Iowan Old Style','Source Serif 4',Georgia,'Times New Roman',serif`;
const SANS = `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace`;

// ── Section tag prefix per category ──────────────────────────────────────────
const CATEGORY_TAGS: Record<string, string> = {
  partnership: "P",
  launch: "L",
  funding: "F",
  technology: "T",
  award: "A",
  customer: "G", // Gartner customer intel
};

// ── Types ────────────────────────────────────────────────────────────────────
export interface DigestSectionItem {
  tag: string;
  company: string;
  headline: string;
  take?: string; // "Why it matters" opinionated one-liner
}

export interface DigestSection {
  num: number;
  label: string;
  title: string;
  items: DigestSectionItem[];
}

export interface DigestData {
  date: string; // "Mon, Apr 20, 2026"
  issue: number;
  headline?: { main: string; sub: string };
  lede?: string;
  pullQuote?: { text: string; attribution: string };
  summary: {
    totalCompanies: number;
    companiesWithActivity: number;
    totalPostsThisWeek: number;
    interestingPostsCount: number;
    totalActiveJobs: number;
  };
  sections: DigestSection[];
  stepErrors: string[];
  meta: {
    runId: number;
    companiesCount: number;
    credits: number;
    dateShort: string; // "Apr 20, 2026"
  };
  appUrl: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// ── Markdown parser ──────────────────────────────────────────────────────────
/**
 * Parses the Gemini weekly-digest markdown into:
 *   - headline { main, sub }     (from `# HEADLINE` / `# SUBHEAD` blocks)
 *   - lede string                (from `# LEDE` block)
 *   - pullQuote { text, attribution } (from `# PULL_QUOTE` / `# ATTRIBUTION`)
 *   - sections with per-item take (from `## heading` + bullets + _Why it matters: …_ line)
 *
 * Backward-compatible with the older format (plain ## sections + **Company** bullets).
 */
export interface ParsedDigest {
  headline?: { main: string; sub: string };
  lede?: string;
  pullQuote?: { text: string; attribution: string };
  sections: DigestSection[];
}

export function parseDigestMarkdown(md: string): ParsedDigest {
  if (!md || /no significant events/i.test(md.split("\n")[0])) {
    return { sections: [] };
  }

  const lines = md.split(/\r?\n/);
  const meta: Record<string, string> = {};
  const sections: DigestSection[] = [];
  let num = 0;
  let currentSection: DigestSection | null = null;
  let currentMeta: string | null = null;
  let metaBuffer: string[] = [];
  let lastItem: DigestSectionItem | null = null;

  const flushMeta = () => {
    if (currentMeta) {
      meta[currentMeta] = metaBuffer.join(" ").replace(/\s+/g, " ").trim();
      currentMeta = null;
      metaBuffer = [];
    }
  };

  const META_KEYS = new Set([
    "HEADLINE",
    "SUBHEAD",
    "LEDE",
    "PULL_QUOTE",
    "ATTRIBUTION",
  ]);

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // "LABEL: value" — single-line meta block (preferred, robust format)
    const labelColon = /^([A-Z][A-Z_ ]{2,})\s*:\s*(.*)$/.exec(line);
    if (labelColon) {
      const key = labelColon[1].trim().toUpperCase().replace(/\s+/g, "_");
      if (META_KEYS.has(key)) {
        flushMeta();
        if (currentSection && currentSection.items.length > 0) {
          sections.push(currentSection);
          currentSection = null;
        }
        currentMeta = key;
        lastItem = null;
        const value = labelColon[2].trim();
        if (value) metaBuffer.push(value);
        continue;
      }
    }

    // "# META_NAME" on a line by itself — legacy/tolerant format (pre-prompt-tighten)
    const h1 = /^#\s+([A-Z_ ]+)$/.exec(line);
    if (h1) {
      const key = h1[1].trim().toUpperCase().replace(/\s+/g, "_");
      if (META_KEYS.has(key)) {
        flushMeta();
        if (currentSection && currentSection.items.length > 0) {
          sections.push(currentSection);
          currentSection = null;
        }
        currentMeta = key;
        lastItem = null;
        continue;
      }
    }

    // ## Section
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      flushMeta();
      if (currentSection && currentSection.items.length > 0) sections.push(currentSection);
      num++;
      const label =
        h2[1].replace(/^[\p{Emoji}\p{S}\p{P}\s]+/u, "").trim() || h2[1].trim();
      currentSection = { num, label, title: label, items: [] };
      lastItem = null;
      continue;
    }

    // Bullet — always starts a new item under the current section
    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet && currentSection) {
      const text = bullet[1].trim();
      const bold = /^\*\*([^*]+)\*\*\s*(.*)$/.exec(text);
      let company = "";
      let headline = text;
      if (bold) {
        company = bold[1].trim();
        headline = bold[2].replace(/^[\s—–-]+/, "").trim();
      }
      const prefix = CATEGORY_TAGS[inferCategoryKey(currentSection.label)] ?? "§";
      const tag = `${prefix}-${pad2(currentSection.items.length + 1)}`;
      lastItem = { tag, company, headline };
      currentSection.items.push(lastItem);
      continue;
    }

    // _Why it matters: ..._ subline attached to the last bullet in the section
    const take = /^\s*_?[Ww]hy it matters[:：]\s*(.*?)_?\s*$/.exec(line);
    if (take && lastItem) {
      const cleaned = take[1].replace(/_+$/g, "").trim();
      if (cleaned) lastItem.take = cleaned;
      continue;
    }

    // Inside a meta block — accumulate
    if (currentMeta && line) {
      metaBuffer.push(line.replace(/^\s+|\s+$/g, ""));
      continue;
    }
  }

  flushMeta();
  if (currentSection && currentSection.items.length > 0) sections.push(currentSection);

  // Renumber in case we dropped empty sections
  const renumbered = sections.map((s, i) => ({ ...s, num: i + 1 }));

  // Tolerant fallback: some models strip HEADLINE:/SUBHEAD:/LEDE: prefixes at
  // the very top. If they did, extract from unlabeled prefix paragraphs
  // (the text that appears before the first `## Section`).
  if (!meta.HEADLINE || !meta.SUBHEAD || !meta.LEDE) {
    const firstSectionIdx = lines.findIndex((l) => /^##\s+/.test(l.trim()));
    const preamble = firstSectionIdx === -1 ? lines : lines.slice(0, firstSectionIdx);
    const paragraphs: string[] = [];
    let buf: string[] = [];
    for (const raw of preamble) {
      const l = raw.trim();
      // Skip already-labeled lines to avoid double-counting
      if (/^([A-Z][A-Z_ ]{2,}):/.test(l) || /^#\s+[A-Z_]+$/.test(l)) {
        if (buf.length) {
          paragraphs.push(buf.join(" ").trim());
          buf = [];
        }
        continue;
      }
      if (!l) {
        if (buf.length) {
          paragraphs.push(buf.join(" ").trim());
          buf = [];
        }
      } else {
        buf.push(l.replace(/^#+\s*/, "")); // strip markdown H1/H2 prefixes
      }
    }
    if (buf.length) paragraphs.push(buf.join(" ").trim());
    const nonEmpty = paragraphs.filter(Boolean);
    if (!meta.HEADLINE && nonEmpty[0]) meta.HEADLINE = nonEmpty[0].replace(/\.$/, "");
    if (!meta.SUBHEAD && nonEmpty[1]) meta.SUBHEAD = nonEmpty[1];
    if (!meta.LEDE && nonEmpty[2]) meta.LEDE = nonEmpty.slice(2).join(" ");
  }

  const headline =
    meta.HEADLINE && meta.SUBHEAD
      ? { main: meta.HEADLINE, sub: meta.SUBHEAD }
      : undefined;
  const pullQuote =
    meta.PULL_QUOTE
      ? {
          text: meta.PULL_QUOTE.replace(/^["']|["']$/g, ""),
          attribution: meta.ATTRIBUTION ?? "",
        }
      : undefined;

  return {
    headline,
    lede: meta.LEDE || undefined,
    pullQuote,
    sections: renumbered,
  };
}

// ── Per-company color palette ────────────────────────────────────────────────
// Curated set that reads on dark BG, deterministically assigned via name hash.
// Order is intentional — first companies in alphabetical order get the most
// distinctive accents (lime, coral, sky) before cycling.
const COMPANY_PALETTE = [
  "#c8ff3f", // lime  (matches global accent — first company keeps continuity)
  "#ff8a4c", // coral
  "#7aa2ff", // sky
  "#ff5ac8", // magenta
  "#ffc857", // amber
  "#5eead4", // mint
  "#a78bfa", // lavender
  "#ffaa6c", // peach
];

function colorForCompany(name: string): string {
  if (!name) return ACCENT;
  const key = name.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return COMPANY_PALETTE[h % COMPANY_PALETTE.length];
}

function inferCategoryKey(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("partner")) return "partnership";
  if (l.includes("launch") || l.includes("feature")) return "launch";
  if (l.includes("fund") || l.includes("business")) return "funding";
  if (l.includes("tech") || l.includes("research")) return "technology";
  if (l.includes("recogn") || l.includes("award")) return "award";
  if (l.includes("customer") || l.includes("gartner")) return "customer";
  return "other";
}

// ── Render ───────────────────────────────────────────────────────────────────
export function renderDigestHtml(d: DigestData): string {
  const { summary, sections, meta, appUrl, stepErrors, headline, lede, pullQuote } = d;

  const preheader = `${summary.interestingPostsCount} material events across ${summary.companiesWithActivity}/${summary.totalCompanies} vendors · ${summary.totalPostsThisWeek} posts · ${summary.totalActiveJobs} open jobs.`;

  // ── Stat rule cells ───────────────────────────────────────────────────────
  const statItems = [
    { label: "Tracked", value: summary.totalCompanies, delta: "" },
    {
      label: "Active",
      value: summary.companiesWithActivity,
      delta: `/${summary.totalCompanies}`,
    },
    { label: "Posts", value: summary.totalPostsThisWeek, delta: "" },
    { label: "Interesting", value: summary.interestingPostsCount, delta: "" },
    { label: "Open jobs", value: summary.totalActiveJobs, delta: "" },
  ];
  const statCells = statItems
    .map((it, i) => {
      const valueHtml = `<span style="font-family:${SERIF};font-size:30px;font-weight:500;color:${INK_LOUD};letter-spacing:-0.7px;">${escape(
        it.value.toLocaleString(),
      )}</span>`;
      const deltaHtml = it.delta
        ? `<span style="font-family:${MONO};font-size:12px;color:${INK_DIM};margin-left:6px;">${escape(
            it.delta,
          )}</span>`
        : "";
      const borderLeft = i === 0 ? "none" : `1px solid ${HAIR}`;
      return `<td style="padding:18px 14px;border-left:${borderLeft};vertical-align:top;" width="20%">
        <div style="font-family:${MONO};font-size:10px;letter-spacing:1.4px;color:${INK_DIM};text-transform:uppercase;margin-bottom:8px;">${escape(
          it.label,
        )}</div>
        <div>${valueHtml}${deltaHtml}</div>
      </td>`;
    })
    .join("");

  // ── Hero right column: headline (main + sub) or fallback ──────────────────
  const heroRightHtml = headline
    ? `<div style="font-family:${MONO};font-size:11px;letter-spacing:2px;color:${INK_DIM};text-transform:uppercase;margin-bottom:14px;">The week's headline</div>
       <div style="font-family:${SERIF};font-size:30px;line-height:1.2;color:${INK_LOUD};letter-spacing:-0.6px;font-weight:500;">${escape(
         headline.main,
       )}</div>
       <div style="font-family:${SERIF};font-size:18px;line-height:1.5;color:${INK_MUTED};margin-top:14px;font-style:italic;">${escape(
         headline.sub,
       )}</div>`
    : `<div style="font-family:${MONO};font-size:11px;letter-spacing:2px;color:${INK_DIM};text-transform:uppercase;margin-bottom:14px;">The week in one number</div>
       <div style="font-family:${SERIF};font-size:24px;line-height:1.3;color:${INK_LOUD};letter-spacing:-0.4px;font-weight:500;">Partnerships, launches, funding, research, and recognition — <span style="font-style:italic;color:${INK_MUTED};">no marketing fluff.</span></div>`;

  // ── Lede block ────────────────────────────────────────────────────────────
  const ledeHtml = lede
    ? `<tr><td style="padding:48px 48px 8px;">
        <div style="font-family:${MONO};font-size:11px;letter-spacing:2px;color:${ACCENT};text-transform:uppercase;margin-bottom:16px;font-weight:600;">The Lede</div>
        <div style="font-family:${SERIF};font-size:22px;line-height:1.5;color:${INK_LOUD};letter-spacing:-0.2px;max-width:580px;">${escape(
          lede,
        )}</div>
      </td></tr>`
    : "";

  // ── Sections ──────────────────────────────────────────────────────────────
  const sectionsHtml = sections.length
    ? sections
        .map((s) => {
          const itemsHtml = s.items
            .map((item, i) => {
              const borderTop = i === 0 ? "none" : `1px solid ${HAIR}`;
              const companyColor = colorForCompany(item.company);
              const takeHtml = item.take
                ? `<tr><td></td>
                    <td style="padding:12px 0 0 0;">
                      <div style="font-family:${SANS};font-size:15px;line-height:1.6;color:${INK_MUTED};border-left:3px solid ${companyColor};padding:4px 0 4px 14px;">
                        <span style="font-family:${MONO};font-size:10px;letter-spacing:1.6px;color:${companyColor};text-transform:uppercase;margin-right:8px;font-weight:600;">Why it matters</span>${escape(
                          item.take,
                        )}
                      </div>
                    </td></tr>`
                : "";
              return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:${borderTop};margin:0;padding:22px 0;">
                <tr>
                  <td style="padding:0 0 8px 0;font-family:${MONO};font-size:11px;letter-spacing:1.6px;color:${INK_DIM};text-transform:uppercase;width:78px;vertical-align:top;">${escape(
                    item.tag,
                  )}</td>
                  <td style="padding:0 0 8px 0;font-family:${SANS};font-size:14px;font-weight:700;color:${companyColor};letter-spacing:0.3px;text-transform:uppercase;vertical-align:top;">${escape(
                    item.company || s.label,
                  )}</td>
                </tr>
                <tr>
                  <td></td>
                  <td style="font-family:${SERIF};font-size:19px;line-height:1.5;color:${INK};padding:0;">${escape(
                    item.headline,
                  )}</td>
                </tr>
                ${takeHtml}
              </table>`;
            })
            .join("");

          return `<tr><td style="padding:40px 0 0;">
            <div style="font-family:${MONO};font-size:11px;letter-spacing:2.4px;color:${ACCENT};text-transform:uppercase;font-weight:600;margin-bottom:12px;">§${pad2(
              s.num,
            )} / ${escape(s.label)}</div>
            <div style="font-family:${SERIF};font-size:34px;font-weight:500;color:${INK_LOUD};letter-spacing:-0.8px;line-height:1.1;margin-bottom:14px;">${escape(
              s.title,
            )}</div>
            ${itemsHtml}
          </td></tr>`;
        })
        .join("")
    : `<tr><td style="padding:48px 0;text-align:center;font-family:${SERIF};font-size:18px;color:${INK_MUTED};font-style:italic;">No material events captured this week.</td></tr>`;

  // ── Pull quote block ──────────────────────────────────────────────────────
  const pullQuoteHtml = pullQuote
    ? `<tr><td style="padding:40px 48px;">
        <div style="border-top:2px solid ${ACCENT};border-bottom:2px solid ${ACCENT};padding:34px 0;">
          <div style="font-family:${MONO};font-size:11px;letter-spacing:2.2px;color:${ACCENT};text-transform:uppercase;margin-bottom:18px;font-weight:600;">★ Quote of the week</div>
          <div style="font-family:${SERIF};font-size:28px;line-height:1.35;font-style:italic;color:${INK_LOUD};letter-spacing:-0.4px;">&ldquo;${escape(
            pullQuote.text,
          )}&rdquo;</div>
          ${pullQuote.attribution ? `<div style="font-family:${SANS};font-size:12px;color:${INK_MUTED};margin-top:16px;letter-spacing:0.4px;text-transform:uppercase;font-weight:600;">— ${escape(
            pullQuote.attribution,
          )}</div>` : ""}
        </div>
      </td></tr>`
    : "";

  // ── Step error block ──────────────────────────────────────────────────────
  const errorsHtml = stepErrors.length
    ? `<tr><td style="padding:24px 48px 0;">
        <div style="border:1px solid #3a2a2a;border-radius:2px;padding:14px 18px;background:#171112;">
          <div style="font-family:${MONO};font-size:10px;letter-spacing:2px;color:#e36b6b;text-transform:uppercase;font-weight:600;margin-bottom:8px;">⚠ ${stepErrors.length} step warning${stepErrors.length > 1 ? "s" : ""}</div>
          <div style="font-family:${SANS};font-size:12px;line-height:1.6;color:${INK_MUTED};">
            ${stepErrors.map((e) => `<div style="padding:2px 0;">${escape(e)}</div>`).join("")}
          </div>
        </div>
      </td></tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark only" />
<meta name="supported-color-schemes" content="dark only" />
<title>CyberTracker — The Dispatch</title>
<!--[if mso]>
<style type="text/css">
  table, td, div, h1, p { font-family: Georgia, serif !important; }
</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:${BG};color:${INK};font-family:${SERIF};">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;opacity:0;line-height:1px;font-size:1px;">${escape(
    preheader,
  )}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BG}" style="background:${BG};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="680" style="width:680px;max-width:680px;background:${BG};">

<!-- Masthead -->
<tr><td style="padding:36px 48px 18px;border-bottom:1px solid ${HAIR};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td style="font-family:${MONO};font-size:10px;letter-spacing:2.8px;color:${INK_DIM};text-transform:uppercase;">
        <span style="display:inline-block;width:10px;height:10px;background:${ACCENT};border-radius:5px;vertical-align:middle;margin-right:8px;">&nbsp;</span><span style="color:${INK};vertical-align:middle;">Cybertracker</span> <span style="vertical-align:middle;">/ Intelligence Unit</span>
      </td>
      <td align="right" style="font-family:${MONO};font-size:10px;letter-spacing:2.8px;color:${INK_DIM};text-transform:uppercase;">
        Vol.1 · №${meta.runId} · ${escape(d.date)}
      </td>
    </tr>
  </table>
  <div style="font-family:${SERIF};font-size:72px;line-height:0.92;font-weight:500;letter-spacing:-2.5px;color:${INK_LOUD};margin-top:22px;margin-bottom:8px;">
    The <span style="font-style:italic;color:${ACCENT};">Dispatch</span>.
  </div>
  <div style="font-family:${SANS};font-size:14px;color:${INK_MUTED};line-height:1.55;max-width:560px;">
    A weekly read on what's moving in the cybersecurity market — assembled from LinkedIn, Gartner, and our own analysis.
  </div>
</td></tr>

<!-- Hero number + headline -->
<tr><td style="padding:36px 48px 32px;border-bottom:1px solid ${HAIR};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td width="42%" valign="top" style="padding-right:18px;">
        <div style="font-family:${MONO};font-size:11px;letter-spacing:2px;color:${ACCENT};text-transform:uppercase;font-weight:600;margin-bottom:12px;">▲ Material events</div>
        <div style="font-family:${SERIF};font-size:112px;line-height:0.85;font-weight:500;color:${INK_LOUD};letter-spacing:-4px;">${summary.interestingPostsCount}</div>
        <div style="font-family:${SANS};font-size:13px;color:${INK_DIM};margin-top:12px;">across ${summary.companiesWithActivity} of ${summary.totalCompanies} vendors we watch</div>
      </td>
      <td width="1%" style="background:${HAIR};width:1px;">&nbsp;</td>
      <td valign="middle" style="padding-left:26px;">
        ${heroRightHtml}
      </td>
    </tr>
  </table>
</td></tr>

<!-- Stat rule -->
<tr><td style="padding:0;background:${BG_ALT};border-bottom:1px solid ${HAIR};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>${statCells}</tr>
  </table>
</td></tr>

${ledeHtml}

<!-- Sections -->
<tr><td style="padding:16px 48px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    ${sectionsHtml}
  </table>
</td></tr>

${pullQuoteHtml}

${errorsHtml}

<!-- CTA -->
<tr><td style="padding:28px 48px 44px;border-top:1px solid ${HAIR};text-align:center;">
  <div style="font-family:${MONO};font-size:11px;letter-spacing:2.2px;color:${INK_DIM};text-transform:uppercase;margin-bottom:18px;">The full briefing</div>
  <a href="${escape(appUrl)}" style="display:inline-block;background:${ACCENT};color:${BG};padding:18px 40px;text-decoration:none;font-family:${SANS};font-weight:700;font-size:14px;letter-spacing:0.6px;text-transform:uppercase;border-radius:2px;">Open dashboard →</a>
  <div style="font-family:${SANS};font-size:13px;color:${INK_DIM};margin-top:16px;">Per-company cards, historical charts, and raw posts.</div>
</td></tr>

<!-- Footer -->
<tr><td style="padding:0 48px 40px;border-top:1px solid ${HAIR};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:26px;">
    <tr>
      <td valign="bottom" style="font-family:${MONO};font-size:11px;letter-spacing:1.8px;color:${INK_DIM};text-transform:uppercase;line-height:1.9;">
        Run №${meta.runId} · ${meta.companiesCount} vendor${meta.companiesCount === 1 ? "" : "s"}<br/>
        ${meta.credits} credits · delivered ${escape(meta.dateShort)}
      </td>
      <td valign="bottom" align="right" style="font-family:${MONO};font-size:11px;letter-spacing:2px;color:${ACCENT};text-transform:uppercase;font-weight:600;">—fin—</td>
    </tr>
  </table>
  <div style="font-family:${SANS};font-size:12px;color:${INK_FADE};margin-top:16px;font-style:italic;max-width:440px;line-height:1.6;">
    You're receiving this because you opted into weekly digests. Reply to this email if you want to change frequency.
  </div>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Plain-text version (used as email fallback) ──────────────────────────────
export function renderDigestText(d: DigestData): string {
  const { summary, sections, meta, appUrl, headline, lede, pullQuote } = d;
  const lines: string[] = [];
  lines.push(`THE DISPATCH — ${d.date}`);
  lines.push(`Vol.1 · №${meta.runId}`);
  lines.push("");
  if (headline) {
    lines.push(headline.main.toUpperCase());
    lines.push(headline.sub);
    lines.push("");
  }
  lines.push(
    `${summary.interestingPostsCount} material events across ${summary.companiesWithActivity}/${summary.totalCompanies} vendors.`,
  );
  lines.push(
    `${summary.totalPostsThisWeek} posts · ${summary.totalActiveJobs} open jobs.`,
  );
  lines.push("");
  if (lede) {
    lines.push(lede);
    lines.push("");
  }
  for (const s of sections) {
    lines.push(`§${pad2(s.num)} — ${s.label.toUpperCase()}`);
    for (const item of s.items) {
      lines.push(`  [${item.tag}] ${item.company}`);
      lines.push(`  ${item.headline}`);
      if (item.take) lines.push(`    why it matters: ${item.take}`);
      lines.push("");
    }
  }
  if (pullQuote) {
    lines.push(`"${pullQuote.text}"`);
    if (pullQuote.attribution) lines.push(`— ${pullQuote.attribution}`);
    lines.push("");
  }
  lines.push("---");
  lines.push(`Open dashboard: ${appUrl}`);
  lines.push(
    `Run #${meta.runId} · ${meta.companiesCount} vendors · ${meta.credits} credits`,
  );
  return lines.join("\n");
}
