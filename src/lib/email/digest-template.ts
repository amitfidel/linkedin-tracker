/**
 * Renders the weekly digest email as email-safe HTML (table-based layout,
 * inline styles, web-safe font stacks). Based on the V2 "Dispatch" design —
 * oversized serif masthead, hero material-events number, stat rule, sections
 * with per-item tag/company/headline, CTA, footer.
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

// ── Markdown parser — extracts sections the template expects ─────────────────
/**
 * Parses the Gemini weekly-digest markdown into structured sections.
 *
 * Expects headings like:
 *   ## 🤝 Partnerships & Integrations
 *   - **Armis** is actively building...
 *
 * Returns an empty array for the "No new Gartner insights" or "No significant
 * events" fallback strings.
 */
export function parseDigestMarkdown(md: string): DigestSection[] {
  if (!md || /no significant events/i.test(md.split("\n")[0])) return [];

  const lines = md.split(/\r?\n/);
  const sections: DigestSection[] = [];
  let num = 0;
  let current: DigestSection | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      if (current && current.items.length > 0) sections.push(current);
      num++;
      // Strip leading emoji/symbol + whitespace from heading ("🤝 Partnerships" → "Partnerships")
      const label = h2[1].replace(/^[\p{Emoji}\p{S}\p{P}\s]+/u, "").trim() || h2[1].trim();
      current = {
        num,
        label,
        title: label,
        items: [],
      };
      continue;
    }
    if (!current) continue;

    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet) {
      const text = bullet[1];
      const bold = /^\*\*([^*]+)\*\*\s*(.*)$/.exec(text);
      let company = "";
      let headline = text;
      if (bold) {
        company = bold[1].trim();
        headline = bold[2].replace(/^[\s—–-]+/, "").trim();
      }
      const prefix = CATEGORY_TAGS[inferCategoryKey(current.label)] ?? "§";
      const tag = `${prefix}-${pad2(current.items.length + 1)}`;
      current.items.push({ tag, company, headline });
    }
  }
  if (current && current.items.length > 0) sections.push(current);

  // Renumber in case we dropped empty sections
  return sections.map((s, i) => ({ ...s, num: i + 1 }));
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
  const { summary, sections, meta, appUrl, stepErrors } = d;

  // Subject info (in preheader)
  const preheader = `${summary.interestingPostsCount} material events across ${summary.companiesWithActivity}/${summary.totalCompanies} vendors · ${summary.totalPostsThisWeek} posts · ${summary.totalActiveJobs} open jobs.`;

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
      const valueHtml = `<span style="font-family:${SERIF};font-size:24px;font-weight:500;color:${INK_LOUD};letter-spacing:-0.6px;">${escape(
        it.value.toLocaleString(),
      )}</span>`;
      const deltaHtml = it.delta
        ? `<span style="font-family:${MONO};font-size:11px;color:${INK_DIM};margin-left:6px;">${escape(
            it.delta,
          )}</span>`
        : "";
      const borderLeft = i === 0 ? "none" : `1px solid ${HAIR}`;
      return `<td style="padding:16px 14px;border-left:${borderLeft};vertical-align:top;" width="20%">
        <div style="font-family:${MONO};font-size:9px;letter-spacing:1.4px;color:${INK_DIM};text-transform:uppercase;margin-bottom:6px;">${escape(
          it.label,
        )}</div>
        <div>${valueHtml}${deltaHtml}</div>
      </td>`;
    })
    .join("");

  const sectionsHtml = sections.length
    ? sections
        .map((s) => {
          const itemsHtml = s.items
            .map((item, i) => {
              const borderTop = i === 0 ? "none" : `1px solid ${HAIR}`;
              const companyRow = `<tr>
                <td style="padding:0 0 6px 0;font-family:${MONO};font-size:10px;letter-spacing:1.6px;color:${INK_DIM};text-transform:uppercase;width:78px;vertical-align:top;">${escape(
                  item.tag,
                )}</td>
                <td style="padding:0 0 6px 0;font-family:${SANS};font-size:13px;font-weight:700;color:${ACCENT};letter-spacing:0.3px;text-transform:uppercase;vertical-align:top;">${escape(
                  item.company || s.label,
                )}</td>
              </tr>`;
              const headlineRow = `<tr>
                <td></td>
                <td style="font-family:${SERIF};font-size:17px;line-height:1.45;color:${INK};padding:0;">${escape(
                  item.headline,
                )}</td>
              </tr>`;
              return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:${borderTop};margin:0;padding:20px 0;">
                ${companyRow}
                ${headlineRow}
              </table>`;
            })
            .join("");

          return `<tr><td style="padding:36px 0 0;">
            <div style="font-family:${MONO};font-size:10px;letter-spacing:2.4px;color:${ACCENT};text-transform:uppercase;font-weight:600;margin-bottom:10px;">§${pad2(
              s.num,
            )} / ${escape(s.label)}</div>
            <div style="font-family:${SERIF};font-size:30px;font-weight:500;color:${INK_LOUD};letter-spacing:-0.8px;line-height:1.1;margin-bottom:12px;">${escape(
              s.title,
            )}</div>
            ${itemsHtml}
          </td></tr>`;
        })
        .join("")
    : `<tr><td style="padding:48px 0;text-align:center;font-family:${SERIF};font-size:18px;color:${INK_MUTED};font-style:italic;">No material events captured this week.</td></tr>`;

  const errorsHtml = stepErrors.length
    ? `<tr><td style="padding:24px 0 0;">
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
  <div style="font-family:${SANS};font-size:13px;color:${INK_MUTED};line-height:1.5;max-width:540px;">
    A weekly read on what's moving in the cybersecurity market — assembled from LinkedIn, Gartner, and our own analysis.
  </div>
</td></tr>

<!-- Hero number -->
<tr><td style="padding:36px 48px 32px;border-bottom:1px solid ${HAIR};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td width="42%" valign="top" style="padding-right:18px;">
        <div style="font-family:${MONO};font-size:10px;letter-spacing:2px;color:${ACCENT};text-transform:uppercase;font-weight:600;margin-bottom:10px;">▲ Material events</div>
        <div style="font-family:${SERIF};font-size:112px;line-height:0.85;font-weight:500;color:${INK_LOUD};letter-spacing:-4px;">${summary.interestingPostsCount}</div>
        <div style="font-family:${SANS};font-size:12px;color:${INK_DIM};margin-top:10px;">across ${summary.companiesWithActivity} of ${summary.totalCompanies} vendors we watch</div>
      </td>
      <td width="1%" style="background:${HAIR};width:1px;">&nbsp;</td>
      <td valign="middle" style="padding-left:26px;">
        <div style="font-family:${MONO};font-size:10px;letter-spacing:2px;color:${INK_DIM};text-transform:uppercase;margin-bottom:12px;">The week in one number</div>
        <div style="font-family:${SERIF};font-size:24px;line-height:1.25;color:${INK_LOUD};letter-spacing:-0.4px;font-weight:500;">
          Partnerships, launches, funding, research, and recognition —
          <span style="font-style:italic;color:${INK_MUTED};">no marketing fluff.</span>
        </div>
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

<!-- Sections -->
<tr><td style="padding:16px 48px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    ${sectionsHtml}
    ${errorsHtml}
  </table>
</td></tr>

<!-- CTA -->
<tr><td style="padding:24px 48px 40px;border-top:1px solid ${HAIR};text-align:center;">
  <div style="font-family:${MONO};font-size:10px;letter-spacing:2.2px;color:${INK_DIM};text-transform:uppercase;margin-bottom:16px;">The full briefing</div>
  <a href="${escape(appUrl)}" style="display:inline-block;background:${ACCENT};color:${BG};padding:16px 36px;text-decoration:none;font-family:${SANS};font-weight:700;font-size:13px;letter-spacing:0.6px;text-transform:uppercase;border-radius:2px;">Open dashboard →</a>
  <div style="font-family:${SANS};font-size:12px;color:${INK_DIM};margin-top:14px;">Per-company cards, historical charts, and raw posts.</div>
</td></tr>

<!-- Footer -->
<tr><td style="padding:0 48px 40px;border-top:1px solid ${HAIR};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;">
    <tr>
      <td valign="bottom" style="font-family:${MONO};font-size:10px;letter-spacing:1.8px;color:${INK_DIM};text-transform:uppercase;line-height:1.9;">
        Run №${meta.runId} · ${meta.companiesCount} vendor${meta.companiesCount === 1 ? "" : "s"}<br/>
        ${meta.credits} credits · delivered ${escape(meta.dateShort)}
      </td>
      <td valign="bottom" align="right" style="font-family:${MONO};font-size:10px;letter-spacing:2px;color:${ACCENT};text-transform:uppercase;font-weight:600;">—fin—</td>
    </tr>
  </table>
  <div style="font-family:${SANS};font-size:11px;color:${INK_FADE};margin-top:14px;font-style:italic;max-width:420px;line-height:1.6;">
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
  const { summary, sections, meta, appUrl } = d;
  const lines: string[] = [];
  lines.push(`THE DISPATCH — ${d.date}`);
  lines.push(`Vol.1 · №${meta.runId}`);
  lines.push("");
  lines.push(
    `${summary.interestingPostsCount} material events across ${summary.companiesWithActivity}/${summary.totalCompanies} vendors.`,
  );
  lines.push(
    `${summary.totalPostsThisWeek} posts · ${summary.totalActiveJobs} open jobs.`,
  );
  lines.push("");
  for (const s of sections) {
    lines.push(`§${pad2(s.num)} — ${s.label.toUpperCase()}`);
    for (const item of s.items) {
      lines.push(`  [${item.tag}] ${item.company}`);
      lines.push(`  ${item.headline}`);
      lines.push("");
    }
  }
  lines.push("---");
  lines.push(`Open dashboard: ${appUrl}`);
  lines.push(
    `Run #${meta.runId} · ${meta.companiesCount} vendors · ${meta.credits} credits`,
  );
  return lines.join("\n");
}
