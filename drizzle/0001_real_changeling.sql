CREATE TABLE `gartner_insights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`scrape_run_id` integer,
	`type` text NOT NULL,
	`text` text NOT NULL,
	`text_hash` text NOT NULL,
	`reviewer_role` text,
	`reviewer_industry` text,
	`scraped_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scrape_run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_gartner_company` ON `gartner_insights` (`company_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_gartner_dedup` ON `gartner_insights` (`company_id`,`text_hash`);--> statement-breakpoint
ALTER TABLE `companies` ADD `gartner_url` text;--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `step_errors` text;--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `ai_summary` text;--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `ai_summary_generated_at` text;