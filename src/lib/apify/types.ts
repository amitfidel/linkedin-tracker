// Raw response types from the All-in-One LinkedIn Scraper (get-leads/linkedin-scraper)
// Field names match what the actor actually returns — verified against live API responses.

export interface RawCompanyData {
  // Core identity
  name?: string;
  url?: string;                  // LinkedIn company URL
  // Details
  description?: string;
  website?: string;
  industry?: string;
  company_size?: string;         // e.g. "501-1,000 employees" (string range, not a number)
  employee_count?: string;       // same as company_size
  followers?: number;            // numeric follower count
  specialties?: string;          // comma-separated string
  headquarters?: string;
  company_type?: string;
  founded?: string;
  logo?: string;                 // logo image URL
  // Bonus: recent posts embedded in company result
  recent_posts?: Array<{ text?: string; url?: string; date?: string }>;
  [key: string]: unknown;
}

export interface RawPostData {
  // Content
  text?: string;
  url?: string;                  // post URL (use as unique ID)
  date?: string;                 // ISO date string
  // Author (for company matching)
  author?: string;               // company name
  author_url?: string;           // company LinkedIn URL
  // Engagement
  likes?: number;
  comments_count?: number;
  shares_count?: number | null;
  // Media
  media_url?: string;            // single image/video URL
  content_type?: string;         // "image" | "video" | "text" | "article"
  hashtags?: string[];
  [key: string]: unknown;
}

export interface RawJobData {
  job_id?: string;               // LinkedIn job ID
  title?: string;
  company?: string;              // Company name that posted the job
  company_url?: string;
  location?: string;
  posted_date?: string;          // e.g. "2 months ago" (relative string)
  url?: string;                  // Full job URL
  description?: string;
  seniority_level?: string;
  employment_type?: string;
  job_function?: string;
  industries?: string;
  salary?: string | null;
  applicants?: number;
  [key: string]: unknown;
}

export interface RawPersonData {
  name?: string;
  url?: string;                  // LinkedIn profile URL
  headline?: string;             // Current title or company
  company?: string;              // Company name (for matching)
  location?: string | null;
  image_url?: string | null;
  [key: string]: unknown;
}
