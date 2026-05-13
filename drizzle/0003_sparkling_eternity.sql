CREATE TABLE `client_interactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_company_id` integer NOT NULL,
	`competitor_company_id` integer NOT NULL,
	`signal_type` text NOT NULL,
	`post_id` integer,
	`personnel_change_id` integer,
	`engager_name` text,
	`engager_profile_url` text,
	`summary` text,
	`matched_by` text,
	`detected_at` text DEFAULT CURRENT_TIMESTAMP,
	`scrape_run_id` integer,
	FOREIGN KEY (`client_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`competitor_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `company_posts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`personnel_change_id`) REFERENCES `personnel_changes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`scrape_run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_client_interactions_client` ON `client_interactions` (`client_company_id`,`detected_at`);--> statement-breakpoint
CREATE INDEX `idx_client_interactions_signal` ON `client_interactions` (`signal_type`);--> statement-breakpoint
CREATE TABLE `post_engagements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`engager_name` text,
	`engager_linkedin_url` text,
	`engager_headline` text,
	`engagement_type` text NOT NULL,
	`comment_text` text,
	`engaged_at` text,
	`scraped_at` text DEFAULT CURRENT_TIMESTAMP,
	`scrape_run_id` integer,
	FOREIGN KEY (`post_id`) REFERENCES `company_posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scrape_run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_engagements_dedup` ON `post_engagements` (`post_id`,`engager_linkedin_url`,`engagement_type`);--> statement-breakpoint
CREATE INDEX `idx_engagements_engager` ON `post_engagements` (`engager_linkedin_url`);--> statement-breakpoint
ALTER TABLE `companies` ADD `category` text DEFAULT 'self' NOT NULL;