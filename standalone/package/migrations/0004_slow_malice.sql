CREATE TABLE `result_chunks` (
	`owner` text NOT NULL,
	`result_id` text NOT NULL,
	`page` integer NOT NULL,
	`body` text NOT NULL,
	`sha256` text NOT NULL,
	PRIMARY KEY(`owner`, `result_id`, `page`)
);
--> statement-breakpoint
ALTER TABLE `cloud_jobs` ADD `recovery_of` text;--> statement-breakpoint
ALTER TABLE `cloud_jobs` ADD `source_task_indices` text;--> statement-breakpoint
CREATE UNIQUE INDEX `cloud_jobs_recovery_unique` ON `cloud_jobs` (`owner`,`recovery_of`);