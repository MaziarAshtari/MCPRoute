import { randomUUID } from 'node:crypto';
import {
  AUTH_MODES,
  KEY_STATUSES,
  LOG_STATUSES,
  PROVIDER_DEFAULTS,
  PROXY_STATUSES,
  ROTATION_STRATEGIES,
  TOOL_FILTER_MODES,
  TOOL_PREFIX_MODES,
  TRANSPORTS,
  defaultFailureRules,
  type FailureRules,
  type McpToolDefinition,
} from '@mcproute/shared';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () =>
  timestamp('created_at')
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());
const bool = (name: string) => integer(name, { mode: 'boolean' });

/** Upstream MCP servers. */
export const providers = sqliteTable('providers', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  transport: text('transport', { enum: TRANSPORTS }).notNull(),
  /** For streamable_http / sse; may contain {{API_KEY}}. */
  url: text('url'),
  /** For stdio; command, args and env values may contain {{API_KEY}}. */
  command: text('command'),
  args: text('args', { mode: 'json' }).$type<string[]>(),
  env: text('env', { mode: 'json' }).$type<Record<string, string>>(),
  authMode: text('auth_mode', { enum: AUTH_MODES }).notNull(),
  authHeaderName: text('auth_header_name').notNull().default(PROVIDER_DEFAULTS.authHeaderName),
  authValueTemplate: text('auth_value_template').notNull().default(PROVIDER_DEFAULTS.authValueTemplate),
  authQueryParam: text('auth_query_param'),
  rotationStrategy: text('rotation_strategy', { enum: ROTATION_STRATEGIES })
    .notNull()
    .default(PROVIDER_DEFAULTS.rotationStrategy),
  failoverEnabled: bool('failover_enabled').notNull().default(PROVIDER_DEFAULTS.failoverEnabled),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(PROVIDER_DEFAULTS.cooldownSeconds),
  failureRules: text('failure_rules', { mode: 'json' }).$type<FailureRules>().notNull().$defaultFn(defaultFailureRules),
  cachedTools: text('cached_tools', { mode: 'json' }).$type<McpToolDefinition[]>(),
  toolsFetchedAt: timestamp('tools_fetched_at'),
  enabled: bool('enabled').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Reusable outbound proxy pool. `url` is canonical (see parseProxyUrl) and unique. */
export const proxies = sqliteTable('proxies', {
  id: id(),
  label: text('label'),
  url: text('url').notNull().unique(),
  enabled: bool('enabled').notNull().default(true),
  status: text('status', { enum: PROXY_STATUSES }).notNull().default('unknown'),
  lastCheckedAt: timestamp('last_checked_at'),
  lastLatencyMs: integer('last_latency_ms'),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: id(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** AES-256-GCM ciphertext of the key (lib/crypto SecretBox). */
    key: text('key').notNull(),
    /** HMAC fingerprint of the plaintext key; detects duplicates without decrypting. */
    keyHash: text('key_hash').notNull(),
    /** Display form, e.g. `sk-****abcd`. */
    keyMask: text('key_mask').notNull(),
    proxyId: text('proxy_id').references(() => proxies.id, { onDelete: 'set null' }),
    enabled: bool('enabled').notNull().default(true),
    weight: integer('weight').notNull().default(1),
    status: text('status', { enum: KEY_STATUSES }).notNull().default('active'),
    cooldownUntil: timestamp('cooldown_until'),
    usageCount: integer('usage_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    activeSessions: integer('active_sessions').notNull().default(0),
    lastUsedAt: timestamp('last_used_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('api_keys_provider_key_hash_idx').on(table.providerId, table.keyHash),
    index('api_keys_proxy_idx').on(table.proxyId),
  ],
);

/** Exposed MCP servers, served at /mcp/{slug}. */
export const endpoints = sqliteTable('endpoints', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  /** SHA-256 hex digest of the access token; the plaintext is only returned on create / regenerate. */
  accessTokenHash: text('access_token_hash').notNull(),
  accessTokenHint: text('access_token_hint').notNull(),
  toolPrefixMode: text('tool_prefix_mode', { enum: TOOL_PREFIX_MODES }).notNull().default('none'),
  enableSse: bool('enable_sse').notNull().default(false),
  enabled: bool('enabled').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const endpointProviders = sqliteTable(
  'endpoint_providers',
  {
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    toolFilterMode: text('tool_filter_mode', { enum: TOOL_FILTER_MODES }).notNull().default('all'),
    toolNames: text('tool_names', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
  },
  (table) => [
    primaryKey({ columns: [table.endpointId, table.providerId] }),
    index('endpoint_providers_provider_idx').on(table.providerId),
  ],
);

/** MCP sessions, persisted so key affinity survives restarts. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at')
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [index('sessions_endpoint_idx').on(table.endpointId), index('sessions_expires_at_idx').on(table.expiresAt)],
);

/** One bound key per provider per session. */
export const sessionBindings = sqliteTable(
  'session_bindings',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    apiKeyId: text('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.providerId] }),
    index('session_bindings_provider_idx').on(table.providerId),
    index('session_bindings_api_key_idx').on(table.apiKeyId),
  ],
);

/**
 * Append-only request history. Deliberately without foreign keys: entries keep the ids of
 * endpoints, sessions, providers, keys and proxies even after those rows are deleted.
 */
export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    endpointId: text('endpoint_id'),
    sessionId: text('session_id'),
    providerId: text('provider_id'),
    apiKeyId: text('api_key_id'),
    proxyId: text('proxy_id'),
    toolName: text('tool_name'),
    method: text('method').notNull(),
    status: text('status', { enum: LOG_STATUSES }).notNull(),
    latencyMs: integer('latency_ms'),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
  },
  (table) => [
    index('request_logs_created_at_idx').on(table.createdAt),
    index('request_logs_endpoint_idx').on(table.endpointId, table.createdAt),
    index('request_logs_provider_idx').on(table.providerId, table.createdAt),
    index('request_logs_api_key_idx').on(table.apiKeyId, table.createdAt),
    index('request_logs_session_idx').on(table.sessionId),
  ],
);

export type ProviderRow = typeof providers.$inferSelect;
export type ProxyRow = typeof proxies.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type EndpointRow = typeof endpoints.$inferSelect;
export type EndpointProviderRow = typeof endpointProviders.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SessionBindingRow = typeof sessionBindings.$inferSelect;
export type RequestLogRow = typeof requestLogs.$inferSelect;
