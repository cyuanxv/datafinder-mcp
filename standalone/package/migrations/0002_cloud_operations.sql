CREATE TABLE `cloud_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`request_key` text NOT NULL,
	`body_hash` text NOT NULL,
	`body` text NOT NULL,
	`state` text NOT NULL,
	`cursor` integer NOT NULL,
	`results` text NOT NULL,
	`attempts` integer NOT NULL,
	`lease_until` integer NOT NULL,
	`lease_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cloud_jobs_owner_request_key_unique` ON `cloud_jobs` (`owner`,`request_key`);--> statement-breakpoint
CREATE TABLE `inspection_observations` (
	`owner` text NOT NULL,
	`run_id` text NOT NULL,
	`rule_key` text NOT NULL,
	`revision` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`state` text NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`owner`, `run_id`, `rule_key`)
);
--> statement-breakpoint
CREATE INDEX `inspection_observations_owner_time` ON `inspection_observations` (`owner`,`created_at`);