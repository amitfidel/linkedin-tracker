CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`linkedin_url` text NOT NULL,
	`linkedin_id` text,
	`industry` text,
	`description` text,
	`website` text,
	`employee_count` integer,
	`specialties` text,
	`headquarters` text,
	`logo_url` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_linkedin_url_unique` ON `companies` (`linkedin_url`);--> statement-breakpoint
CREATE TABLE `company_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`linkedin_post_id` text,
	`content` text,
	`post_type` text,
	`likes_count` integer DEFAULT 0,
	`comments_count` integer DEFAULT 0,
	`shares_count` integer DEFAULT 0,
	`posted_at` text,
	`scraped_at` text DEFAULT CURRENT_TIMESTAMP,
	`scrape_run_id` integer,
	`media_urls` text,
	`hashtags` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scrape_run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_posts_linkedin_post_id_unique` ON `company_posts` (`linkedin_post_id`);--> statement-breakpoint
CREATE INDEX `idx_posts_company_date` ON `company_posts` (`company_id`,`posted_at`);--> statement-breakpoint
CREATE TABLE `company_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`employee_count` integer,
	`follower_count` integer,
	`scrape_run_id` integer,
	`scraped_at` text DEFAULT CURRENT_TIMESTAMP,
	`raw_data` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scrape_run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `job_listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`employment_type` text,
	`seniority_level` text,
	`description` text,
	`skills` text,
	`linkedin_job_id` text,
	`posted_at` text,
	`scraped_at` text DEFAULT CURRENT_TIMESTAMP,
	`scrape_run_id` integer,
	`is_active` integer DEFAULT true,
	`closed_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scrape_run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_listings_linkedin_job_id_unique` ON `job_listings` (`linkedin_job_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_company_date` ON `job_listings` (`company_id`,`scraped_at`);--> statement-breakpoint
CREATE TABLE `key_personnel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`linkedin_profile_url` text,
	`name` text NOT NULL,
	`title` text,
	`is_current` integer DEFAULT true,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP,
	`scrape_run_id` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scrape_run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_personnel_company` ON `key_personnel` (`company_id`,`is_current`);--> statement-breakpoint
CREATE TABLE `personnel_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer,
	`company_id` integer NOT NULL,
	`change_type` text NOT NULL,
	`old_title` text,
	`new_title` text,
	`person_name` text,
	`detected_at` text DEFAULT CURRENT_TIMESTAMP,
	`scrape_run_id` integer,
	FOREIGN KEY (`person_id`) REFERENCES `key_personnel`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scrape_run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `schedule_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`cron_expression` text DEFAULT '0 2 * * 1',
	`is_enabled` integer DEFAULT true,
	`last_run_at` text,
	`next_run_at` text
);
--> statement-breakpoint
CREATE TABLE `scrape_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger_type` text NOT NULL,
	`status` text DEFAULT 'pending',
	`started_at` text DEFAULT CURRENT_TIMESTAMP,
	`completed_at` text,
	`error_message` text,
	`companies_count` integer,
	`apify_run_ids` text,
	`credits_used` real
);
--> statement-breakpoint
CREATE INDEX `idx_runs_started` ON `scrape_runs` (`started_at`);