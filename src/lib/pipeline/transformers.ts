import type {
  RawCompanyData,
  RawPostData,
  RawJobData,
  RawPersonData,
} from "../apify/types";
import type { NewCompany } from "@/db/schema";
import { extractSkills } from "./cyber-keywords";

/** Parse "501-1,000 employees" → midpoint integer (751) or null. */
function parseEmployeeCount(raw: string | number | undefined | null): number | null {
  if (!raw) return null;
  if (typeof raw === "number") return raw;
  // Extract all numbers from the string and return the average
  const nums = raw.match(/[\d,]+/g);
  if (!nums || nums.length === 0) return null;
  const values = nums.map((n) => parseInt(n.replace(/,/g, ""), 10));
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function transformCompany(
  raw: RawCompanyData
): Partial<NewCompany> & { followerCount?: number } {
  return {
    name: raw.name || "Unknown",
    linkedinUrl: raw.url || "",
    description: raw.description ?? null,
    website: raw.website ?? null,
    industry: raw.industry ?? null,
    employeeCount: parseEmployeeCount(raw.company_size ?? raw.employee_count),
    specialties: raw.specialties ? raw.specialties : null, // already a string
    headquarters: raw.headquarters ?? null,
    logoUrl: raw.logo ?? null,
    followerCount: raw.followers ?? undefined,
  };
}

export function transformPost(raw: RawPostData, companyId: number) {
  // `raw.url` is the canonical post URL and serves as the unique ID
  const postId = raw.url ?? null;

  const hashtags: string[] = Array.isArray(raw.hashtags) ? raw.hashtags : extractHashtags(raw.text ?? "");

  return {
    companyId,
    linkedinPostId: postId,
    content: raw.text ?? null,
    postType: raw.content_type ?? inferPostType(raw),
    likesCount: raw.likes ?? 0,
    commentsCount: raw.comments_count ?? 0,
    sharesCount: raw.shares_count ?? 0,
    postedAt: raw.date ?? null,
    mediaUrls: raw.media_url ? JSON.stringify([raw.media_url]) : JSON.stringify([]),
    hashtags: JSON.stringify(hashtags),
  };
}

export function transformJob(raw: RawJobData, companyId: number) {
  const skills = extractSkills(`${raw.title ?? ""} ${raw.description ?? ""}`);
  return {
    companyId,
    title: raw.title || "Unknown Role",
    location: raw.location ?? null,
    employmentType: raw.employment_type ?? null,
    seniorityLevel: raw.seniority_level ?? null,
    description: raw.description ?? null,
    skills: JSON.stringify(skills),
    linkedinJobId: raw.job_id ?? raw.url ?? null,
    postedAt: null, // "2 months ago" is relative — we record scrape time instead
  };
}

export function transformPerson(raw: RawPersonData, companyId: number) {
  return {
    companyId,
    linkedinProfileUrl: raw.url ?? null,
    name: raw.name || "Unknown",
    title: raw.headline ?? null, // headline often contains role title
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w]+/g);
  return matches ? matches.map((h) => h.toLowerCase()) : [];
}

function inferPostType(raw: RawPostData): string {
  const ct = (raw.content_type ?? "").toLowerCase();
  if (ct === "video") return "video";
  if (ct === "article") return "article";
  if (ct === "image") return "image";
  return "text";
}
