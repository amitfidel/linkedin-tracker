/**
 * Real-time email alerts for high-strength client signals.
 *
 * Reuses the existing Resend account + DIGEST_EMAIL_TO that the weekly
 * digest sends from. Different subject line ("🔔 Alert…") so you can
 * filter these into a separate label / Important bucket if you want.
 */
import { Resend } from "resend";
import type { SignalForAlert } from "./slack";

const ACCENT = "#c8ff3f";
const BG = "#0d0d0e";
const INK = "#ebe7dd";
const INK_LOUD = "#faf7ee";
const INK_MUTED = "#9a9688";
const INK_DIM = "#6a665c";
const HAIR = "#1c1c1e";

const SERIF = `'Charter','Iowan Old Style','Source Serif 4',Georgia,'Times New Roman',serif`;
const SANS = `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace`;

// Stable per-company colors — match digest-template.ts palette so any
// company shows the same hue everywhere.
const COMPANY_PALETTE = [
  "#c8ff3f",
  "#ff8a4c",
  "#7aa2ff",
  "#ff5ac8",
  "#ffc857",
  "#5eead4",
  "#a78bfa",
  "#ffaa6c",
];
function colorFor(name: string): string {
  if (!name) return ACCENT;
  let h = 0;
  const k = name.trim().toLowerCase();
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return COMPANY_PALETTE[h % COMPANY_PALETTE.length];
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emojiFor(t: string): string {
  if (t === "personnel_move") return "🚨";
  if (t === "post_engagement") return "👀";
  if (t === "post_mention") return "💬";
  return "•";
}

function labelFor(t: string): string {
  if (t === "personnel_move") return "Personnel move";
  if (t === "post_engagement") return "Engagement";
  if (t === "post_mention") return "Mention";
  return t;
}

function subjectFor(signals: SignalForAlert[]): string {
  if (signals.length === 0) return "🔔 CyberTracker alert";
  // Use top 2 client names for context; fall back to count for big batches
  if (signals.length === 1) {
    const s = signals[0];
    return `🔔 ${s.clientName} ↔ ${s.competitorName} — ${labelFor(s.signalType).toLowerCase()}`;
  }
  const topClients = Array.from(
    new Set(signals.map((s) => s.clientName)),
  ).slice(0, 3);
  return `🔔 ${signals.length} new client signals — ${topClients.join(", ")}`;
}

function renderHtml(signals: SignalForAlert[], appUrl: string): string {
  const itemsHtml = signals
    .map((s, i) => {
      const clientColor = colorFor(s.clientName);
      const competitorColor = colorFor(s.competitorName);
      const matchTag = s.matchedBy
        ? `<span style="font-family:${MONO};font-size:10px;letter-spacing:1.4px;color:${INK_DIM};text-transform:uppercase;margin-left:8px;">via ${escape(s.matchedBy)}</span>`
        : "";
      const postLink = s.postUrl
        ? `<div style="margin-top:8px;"><a href="${escape(s.postUrl)}" style="color:${ACCENT};font-family:${SANS};font-size:13px;text-decoration:none;">open post →</a></div>`
        : "";
      const borderTop = i === 0 ? "none" : `1px solid ${HAIR}`;
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:${borderTop};padding:20px 0;margin:0;">
        <tr>
          <td style="width:36px;font-size:22px;vertical-align:top;padding-top:2px;">${emojiFor(s.signalType)}</td>
          <td>
            <div style="font-family:${MONO};font-size:10px;letter-spacing:1.6px;color:${INK_DIM};text-transform:uppercase;margin-bottom:6px;">${escape(labelFor(s.signalType))}${matchTag}</div>
            <div style="font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;margin-bottom:8px;">
              <span style="color:${clientColor};">${escape(s.clientName)}</span>
              <span style="color:${INK_DIM};font-weight:400;text-transform:none;letter-spacing:0;"> ↔ </span>
              <span style="color:${competitorColor};">${escape(s.competitorName)}</span>
            </div>
            <div style="font-family:${SERIF};font-size:17px;line-height:1.5;color:${INK_LOUD};">${escape(s.summary ?? "")}</div>
            ${postLink}
          </td>
        </tr>
      </table>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark only" />
<title>CyberTracker alert</title>
</head>
<body style="margin:0;padding:0;background:${BG};color:${INK};font-family:${SERIF};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BG}" style="background:${BG};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width:640px;max-width:640px;background:${BG};">

<tr><td style="padding:24px 36px 8px;">
  <div style="font-family:${MONO};font-size:10px;letter-spacing:2.4px;color:${ACCENT};text-transform:uppercase;font-weight:600;margin-bottom:10px;">🔔 Real-time alert</div>
  <div style="font-family:${SERIF};font-size:32px;line-height:1.15;color:${INK_LOUD};letter-spacing:-0.6px;font-weight:500;">${signals.length} new client signal${signals.length === 1 ? "" : "s"}</div>
  <div style="font-family:${SANS};font-size:13px;color:${INK_MUTED};margin-top:6px;">Detected just now during the daily watch.</div>
</td></tr>

<tr><td style="padding:8px 36px 24px;">
  ${itemsHtml}
</td></tr>

<tr><td style="padding:0 36px 32px;text-align:center;border-top:1px solid ${HAIR};padding-top:24px;">
  <a href="${escape(appUrl)}" style="display:inline-block;background:${ACCENT};color:${BG};padding:14px 32px;text-decoration:none;font-family:${SANS};font-weight:700;font-size:13px;letter-spacing:0.6px;text-transform:uppercase;border-radius:2px;">Open dashboard →</a>
  <div style="font-family:${SANS};font-size:11px;color:${INK_DIM};margin-top:14px;">Full context on every signal — engager profile, post link, history.</div>
</td></tr>

<tr><td style="padding:0 36px 32px;">
  <div style="font-family:${SANS};font-size:11px;color:${INK_DIM};line-height:1.6;border-top:1px solid ${HAIR};padding-top:16px;">
    You're receiving this because at least one client signal crossed your strength threshold.
    The weekly Dispatch will batch the rest. Adjust SLACK_MIN_STRENGTH in .env to fire more or less.
  </div>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderText(signals: SignalForAlert[], appUrl: string): string {
  const lines = [
    `🔔 CYBERTRACKER ALERT — ${signals.length} new client signal${signals.length === 1 ? "" : "s"}`,
    "",
  ];
  for (const s of signals) {
    lines.push(
      `${emojiFor(s.signalType)} [${labelFor(s.signalType)}] ${s.clientName} ↔ ${s.competitorName}`,
    );
    if (s.summary) lines.push(`   ${s.summary}`);
    if (s.postUrl) lines.push(`   ${s.postUrl}`);
    lines.push("");
  }
  lines.push("---");
  lines.push(`Open dashboard: ${appUrl}`);
  return lines.join("\n");
}

/** Send the email alert via Resend. Returns when accepted. */
export async function sendEmailAlert(
  signals: SignalForAlert[],
): Promise<void> {
  if (signals.length === 0) return;
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_EMAIL_TO;
  const from =
    process.env.DIGEST_EMAIL_FROM ?? "CyberTracker <onboarding@resend.dev>";
  const appUrl =
    process.env.DIGEST_APP_URL ?? "http://localhost:3000";

  if (!apiKey || !to) {
    console.warn(
      "[email-alert] skipping: RESEND_API_KEY or DIGEST_EMAIL_TO not set",
    );
    return;
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: subjectFor(signals),
    html: renderHtml(signals, appUrl),
    text: renderText(signals, appUrl),
  });
  if (error) {
    throw new Error(`Resend error: ${error.message ?? JSON.stringify(error)}`);
  }
  console.log(`[email-alert] sent to ${to} (${signals.length} signals)`);
}
