CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_label` text NOT NULL,
	`account_label` text NOT NULL,
	`broker_label` text NOT NULL,
	`depository` text DEFAULT 'CDSL' NOT NULL,
	`boid_last4` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`view_rights_verified_at` text NOT NULL,
	`last_successful_sync_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_active` ON `accounts` (`active`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`account_id` text,
	`outcome` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_created` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`sync_run_id` text NOT NULL,
	`account_id` text NOT NULL,
	`isin` text NOT NULL,
	`security_name` text NOT NULL,
	`listing_status` text NOT NULL,
	`paid_up_value` text,
	`quantity` text NOT NULL,
	`last_closing_price` text NOT NULL,
	`holding_value` text NOT NULL,
	PRIMARY KEY(`sync_run_id`, `isin`),
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_holdings_account_sync` ON `holdings` (`account_id`,`sync_run_id`);--> statement-breakpoint
CREATE TABLE `ingest_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`used_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text NOT NULL,
	`source_as_of_date` text NOT NULL,
	`price_date` text NOT NULL,
	`row_count` integer NOT NULL,
	`source_total_value` text NOT NULL,
	`normalized_total_value` text NOT NULL,
	`parser_version` text NOT NULL,
	`page_signature` text NOT NULL,
	`error_code` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_runs_account_completed` ON `sync_runs` (`account_id`,`completed_at`);