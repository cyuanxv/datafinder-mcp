CREATE TABLE `metadata_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan` text NOT NULL,
	`plan_hash` text NOT NULL,
	`state` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`result` text
);
