CREATE TABLE `governance_records` (
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`record_key` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `kind`, `record_key`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `governance_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
