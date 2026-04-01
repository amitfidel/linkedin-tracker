import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  linkedinUrl: text("linkedin_url").notNull().unique(),
  linkedinId: text("linkedin_id"),
  industry: text("industry"),
  description: text("description"),
  website: text("website"),
  employeeCount: integer("employee_count"),
  specialties: text("specialties"), // JSON array
  headquarters: text("headquarters"),
  logoUrl: text("logo_url"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  gartnerUrl: text("gartner_url"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const companySnapshots = sqliteTable("company_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  employeeCount: integer("employee_count"),
  followerCount: integer("follower_count"),
  scrapeRunId: integer("scrape_run_id").references(() => scrapeRuns.id),
  scrapedAt: text("scraped_at").default(sql`CURRENT_TIMESTAMP`),
  rawData: text("raw_data"), // full JSON
});

export const companyPosts = sqliteTable(
  "company_posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    linkedinPostId: text("linkedin_post_id").unique(),
    content: text("content"),
    postType: text("post_type"), // text, image, video, article
    likesCount: integer("likes_count").default(0),
    commentsCount: integer("comments_count").default(0),
    sharesCount: integer("shares_count").default(0),
    postedAt: text("posted_at"),
    scrapedAt: text("scraped_at").default(sql`CURRENT_TIMESTAMP`),
    scrapeRunId: integer("scrape_run_id").references(() => scrapeRuns.id),
    mediaUrls: text("media_urls"), // JSON array
    hashtags: text("hashtags"), // JSON array
  },
  (table) => [
    index("idx_posts_company_date").on(table.companyId, table.postedAt),
  ]
);

export const jobListings = sqliteTable(
  "job_listings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    location: text("location"),
    employmentType: text("employment_type"),
    seniorityLevel: text("seniority_level"),
    description: text("description"),
    skills: text("skills"), // JSON array of extracted tech/skill keywords
    linkedinJobId: text("linkedin_job_id").unique(),
    postedAt: text("posted_at"),
    scrapedAt: text("scraped_at").default(sql`CURRENT_TIMESTAMP`),
    scrapeRunId: integer("scrape_run_id").references(() => scrapeRuns.id),
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    closedAt: text("closed_at"),
  },
  (table) => [
    index("idx_jobs_company_date").on(table.companyId, table.scrapedAt),
  ]
);

export const keyPersonnel = sqliteTable(
  "key_personnel",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    linkedinProfileUrl: text("linkedin_profile_url"),
    name: text("name").notNull(),
    title: text("title"),
    isCurrent: integer("is_current", { mode: "boolean" }).default(true),
    firstSeenAt: text("first_seen_at").default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").default(sql`CURRENT_TIMESTAMP`),
    scrapeRunId: integer("scrape_run_id").references(() => scrapeRuns.id),
  },
  (table) => [
    index("idx_personnel_company").on(table.companyId, table.isCurrent),
  ]
);

export const personnelChanges = sqliteTable("personnel_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: integer("person_id").references(() => keyPersonnel.id),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  changeType: text("change_type").notNull(), // 'joined', 'left', 'title_change'
  oldTitle: text("old_title"),
  newTitle: text("new_title"),
  personName: text("person_name"),
  detectedAt: text("detected_at").default(sql`CURRENT_TIMESTAMP`),
  scrapeRunId: integer("scrape_run_id").references(() => scrapeRuns.id),
});

export const scrapeRuns = sqliteTable(
  "scrape_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    triggerType: text("trigger_type").notNull(), // 'manual' or 'scheduled'
    status: text("status").default("pending"), // pending, running, completed, failed
    startedAt: text("started_at").default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
    errorMessage: text("error_message"),
    companiesCount: integer("companies_count"),
    apifyRunIds: text("apify_run_ids"), // JSON array
    creditsUsed: real("credits_used"),
    stepErrors: text("step_errors"),          // JSON array of per-step error messages
    aiSummary: text("ai_summary"),            // AI-generated weekly summary text
    aiSummaryGeneratedAt: text("ai_summary_generated_at"),
  },
  (table) => [index("idx_runs_started").on(table.startedAt)]
);

export const scheduleConfig = sqliteTable("schedule_config", {
  id: integer("id").primaryKey().default(1),
  cronExpression: text("cron_expression").default("0 2 * * 1"), // Monday 2 AM
  isEnabled: integer("is_enabled", { mode: "boolean" }).default(true),
  lastRunAt: text("last_run_at"),
  nextRunAt: text("next_run_at"),
});

export const gartnerInsights = sqliteTable(
  "gartner_insights",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    scrapeRunId: integer("scrape_run_id").references(() => scrapeRuns.id),
    type: text("type").notNull(), // 'like' or 'dislike'
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(), // SHA-256 of full text
    reviewUrl: text("review_url"), // canonical dedup key (review page URL)
    reviewerRole: text("reviewer_role"),
    reviewerIndustry: text("reviewer_industry"),
    scrapedAt: text("scraped_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_gartner_company").on(table.companyId, table.type),
    index("idx_gartner_dedup").on(table.companyId, table.textHash),
  ]
);

// Type exports
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type CompanyPost = typeof companyPosts.$inferSelect;
export type JobListing = typeof jobListings.$inferSelect;
export type KeyPerson = typeof keyPersonnel.$inferSelect;
export type PersonnelChange = typeof personnelChanges.$inferSelect;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type ScheduleConfig = typeof scheduleConfig.$inferSelect;
export type GartnerInsight = typeof gartnerInsights.$inferSelect;
export type NewGartnerInsight = typeof gartnerInsights.$inferInsert;
