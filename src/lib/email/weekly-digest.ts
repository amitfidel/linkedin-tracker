import { Resend } from "resend";
import { marked } from "marked";

interface WeeklyDigestInput {
  summaryMarkdown: string;
  companiesCount: number;
  creditsUsed: number;
  runId: number;
  stepErrors: string[];
}

function formatDateHuman(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderHtml(input: WeeklyDigestInput, appUrl: string): string {
  const bodyHtml = marked.parse(input.summaryMarkdown, { async: false }) as string;
  const errorsBlock =
    input.stepErrors.length > 0
      ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;margin:16px 0;color:#991b1b;font-size:13px"><strong>Step warnings (${input.stepErrors.length}):</strong><ul style="margin:8px 0 0 0;padding-left:20px">${input.stepErrors.map((e) => `<li>${e.replace(/</g, "&lt;")}</li>`).join("")}</ul></div>`
      : "";

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#111;line-height:1.55">
  <h1 style="font-size:22px;margin:0 0 4px">CyberTracker Weekly Digest</h1>
  <p style="color:#6b7280;margin:0 0 24px;font-size:14px">${formatDateHuman(new Date())} · ${input.companiesCount} companies tracked</p>
  <div style="font-size:15px">${bodyHtml}</div>
  ${errorsBlock}
  <p style="margin:32px 0 8px"><a href="${appUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">View full dashboard →</a></p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
  <p style="color:#9ca3af;font-size:12px;margin:0">Run #${input.runId} · ${input.creditsUsed} Apify credits used · <a href="${appUrl}" style="color:#6b7280">${appUrl}</a></p>
</body></html>`;
}

export async function sendWeeklyDigest(input: WeeklyDigestInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_EMAIL_TO;
  const from = process.env.DIGEST_EMAIL_FROM ?? "CyberTracker <onboarding@resend.dev>";
  const appUrl = process.env.DIGEST_APP_URL ?? "https://linkedin-tracker-production-4f02.up.railway.app";

  if (!apiKey || !to) {
    console.warn("[digest-email] Skipping: RESEND_API_KEY or DIGEST_EMAIL_TO not set");
    return;
  }

  const resend = new Resend(apiKey);
  const subject = `CyberTracker Weekly Digest — ${formatDateHuman(new Date())}`;

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html: renderHtml(input, appUrl),
    text: `${input.summaryMarkdown}\n\n---\nView dashboard: ${appUrl}\nRun #${input.runId} · ${input.companiesCount} companies · ${input.creditsUsed} credits`,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message ?? JSON.stringify(error)}`);
  }
  console.log(`[digest-email] Sent to ${to}`);
}
