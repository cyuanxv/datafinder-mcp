CREATE INDEX `cloud_jobs_owner_created_id` ON `cloud_jobs` (`owner`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `dispatch_runs_history` ON `dispatch_runs` (`owner`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `job_attempts_history` ON `job_attempts` (`owner`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `job_attempts_job_history` ON `job_attempts` (`owner`,`job_id`,`started_at`,`id`);