CREATE TABLE `people_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`linkedin_profile_url` text NOT NULL,
	`company_id` integer NOT NULL,
	`name` text,
	`headline` text,
	`source` text NOT NULL,
	`observed_at` text DEFAULT CURRENT_TIMESTAMP,
	`scrape_run_id` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scrape_run_id`) REFERENCES `scrape_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_obs_profile` ON `people_observations` (`linkedin_profile_url`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_obs_run` ON `people_observations` (`scrape_run_id`);--> statement-breakpoint
ALTER TABLE `client_interactions` ADD `alerted_at` text;