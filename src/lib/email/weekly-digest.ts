import { Resend } from "resend";
import { generateWeeklyDigest } from "../analysis/digest-generator";
import {
  parseDigestMarkdown,
  renderDigestHtml,
  renderDigestText,
  type DigestData,
} from "./digest-template";

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

function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export async function sendWeeklyDigest(input: WeeklyDigestInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_EMAIL_TO;
  const from =
    process.env.DIGEST_EMAIL_FROM ?? "CyberTracker <onboarding@resend.dev>";
  const appUrl =
    process.env.DIGEST_APP_URL ??
    "https://linkedin-tracker-production-4f02.up.railway.app";

  if (!apiKey || !to) {
    console.warn(
      "[digest-email] Skipping: RESEND_API_KEY or DIGEST_EMAIL_TO not set",
    );
    return;
  }

  // Pull real stats from the DB (totalCompanies, active, posts, interesting, jobs)
  const digest = await generateWeeklyDigest();

  const parsed = parseDigestMarkdown(input.summaryMarkdown);
  const now = new Date();
  const data: DigestData = {
    date: formatDateHuman(now),
    issue: input.runId,
    headline: parsed.headline,
    lede: parsed.lede,
    pullQuote: parsed.pullQuote,
    summary: digest.summary,
    sections: parsed.sections,
    stepErrors: input.stepErrors,
    meta: {
      runId: input.runId,
      companiesCount: input.companiesCount,
      credits: input.creditsUsed,
      dateShort: formatDateShort(now),
    },
    appUrl,
  };

  const html = renderDigestHtml(data);
  const text = renderDigestText(data);

  const subject = `The Dispatch — ${data.summary.interestingPostsCount} material event${data.summary.interestingPostsCount === 1 ? "" : "s"} · ${formatDateShort(now)}`;

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(
      `Resend error: ${error.message ?? JSON.stringify(error)}`,
    );
  }
  console.log(`[digest-email] Sent to ${to}`);
}
