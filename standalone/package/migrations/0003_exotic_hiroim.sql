CREATE TABLE `dispatch_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`submitted_count` integer DEFAULT 0 NOT NULL,
	`processed_job_id` text,
	`error_code` text
);
--> statement-breakpoint
CREATE INDEX `dispatch_runs_owner_time` ON `dispatch_runs` (`owner`,`started_at`);--> statement-breakpoint
CREATE TABLE `job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`job_id` text NOT NULL,
	`task_index` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`error_code` text
);
--> statement-breakpoint
CREATE INDEX `job_attempts_owner_time` ON `job_attempts` (`owner`,`started_at`);