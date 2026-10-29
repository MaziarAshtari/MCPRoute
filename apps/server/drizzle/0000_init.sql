CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`label` text NOT NULL,
	`key` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_mask` text NOT NULL,
	`proxy_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`cooldown_until` integer,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`active_sessions` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proxy_id`) REFERENCES `proxies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_provider_key_hash_idx` ON `api_keys` (`provider_id`,`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_proxy_idx` ON `api_keys` (`proxy_id`);--> statement-breakpoint
CREATE TABLE `endpoint_providers` (
	`endpoint_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`tool_filter_mode` text DEFAULT 'all' NOT NULL,
	`tool_names` text NOT NULL,
	PRIMARY KEY(`endpoint_id`, `provider_id`),
	FOREIGN KEY (`endpoint_id`) REFERENCES `endpoints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `endpoint_providers_provider_idx` ON `endpoint_providers` (`provider_id`);--> statement-breakpoint
CREATE TABLE `endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`access_token_hash` text NOT NULL,
	`access_token_hint` text NOT NULL,
	`tool_prefix_mode` text DEFAULT 'none' NOT NULL,
	`enable_sse` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `endpoints_slug_unique` ON `endpoints` (`slug`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`transport` text NOT NULL,
	`url` text,
	`command` text,
	`args` text,
	`env` text,
	`auth_mode` text NOT NULL,
	`auth_header_name` text DEFAULT 'Authorization' NOT NULL,
	`auth_value_template` text DEFAULT 'Bearer {{API_KEY}}' NOT NULL,
	`auth_query_param` text,
	`rotation_strategy` text DEFAULT 'round_robin' NOT NULL,
	`failover_enabled` integer DEFAULT true NOT NULL,
	`cooldown_seconds` integer DEFAULT 300 NOT NULL,
	`failure_rules` text NOT NULL,
	`cached_tools` text,
	`tools_fetched_at` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_slug_unique` ON `providers` (`slug`);--> statement-breakpoint
CREATE TABLE `proxies` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text,
	`url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_checked_at` integer,
	`last_latency_ms` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proxies_url_unique` ON `proxies` (`url`);--> statement-breakpoint
CREATE TABLE `request_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint_id` text,
	`session_id` text,
	`provider_id` text,
	`api_key_id` text,
	`proxy_id` text,
	`tool_name` text,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`latency_ms` integer,
	`error_message` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_logs_created_at_idx` ON `request_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `request_logs_endpoint_idx` ON `request_logs` (`endpoint_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `request_logs_provider_idx` ON `request_logs` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `request_logs_api_key_idx` ON `request_logs` (`api_key_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `request_logs_session_idx` ON `request_logs` (`session_id`);--> statement-breakpoint
CREATE TABLE `session_bindings` (
	`session_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`api_key_id` text NOT NULL,
	PRIMARY KEY(`session_id`, `provider_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_bindings_provider_idx` ON `session_bindings` (`provider_id`);--> statement-breakpoint
CREATE INDEX `session_bindings_api_key_idx` ON `session_bindings` (`api_key_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_endpoint_idx` ON `sessions` (`endpoint_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);