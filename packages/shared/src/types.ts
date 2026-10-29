import type {
  AuthMode,
  FailureRules,
  KeyStatus,
  LogStatus,
  ProxyScheme,
  ProxyStatus,
  RotationStrategy,
  ToolFilterMode,
  ToolPrefixMode,
  Transport,
} from './constants';
import type { BulkLineError } from './parsers/lines';

/** Response bodies of the admin REST API. Timestamps are ISO 8601 strings. */

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HealthDto {
  status: 'ok';
}

export interface AdminSessionDto {
  username: string;
  expiresAt: string;
}

/** Tool definition as returned by an upstream MCP server (`tools/list`). */
export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface KeyStats {
  total: number;
  enabled: number;
  active: number;
  cooldown: number;
  disabled: number;
}

export interface ProviderDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  transport: Transport;
  url: string | null;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  authMode: AuthMode;
  authHeaderName: string;
  authValueTemplate: string;
  authQueryParam: string | null;
  rotationStrategy: RotationStrategy;
  failoverEnabled: boolean;
  cooldownSeconds: number;
  failureRules: FailureRules;
  cachedTools: McpToolDefinition[] | null;
  toolsFetchedAt: string | null;
  enabled: boolean;
  keyStats: KeyStats;
  createdAt: string;
  updatedAt: string;
}

/** Proxy summary embedded in other resources; the password is masked. */
export interface ProxyRefDto {
  id: string;
  label: string | null;
  url: string;
  status: ProxyStatus;
  enabled: boolean;
}

export interface ApiKeyDto {
  id: string;
  providerId: string;
  label: string;
  /** e.g. `sk-****abcd`; the full key is never returned. */
  maskedKey: string;
  proxyId: string | null;
  proxy: ProxyRefDto | null;
  enabled: boolean;
  weight: number;
  status: KeyStatus;
  cooldownUntil: string | null;
  usageCount: number;
  errorCount: number;
  activeSessions: number;
  lastUsedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyDto {
  id: string;
  label: string | null;
  /** Canonical URL with the password masked, e.g. `socks5://user:****@1.2.3.4:1080`. */
  url: string;
  scheme: ProxyScheme;
  host: string;
  port: number;
  username: string | null;
  hasPassword: boolean;
  enabled: boolean;
  status: ProxyStatus;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  /** Number of API keys currently routed through this proxy. */
  keyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EndpointProviderDto {
  providerId: string;
  providerName: string;
  providerSlug: string;
  toolFilterMode: ToolFilterMode;
  toolNames: string[];
}

export interface EndpointDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** Path of the exposed MCP server, e.g. `/mcp/my-endpoint`. */
  mcpPath: string;
  /** Last characters of the access token, for identification only. */
  accessTokenHint: string;
  toolPrefixMode: ToolPrefixMode;
  enableSse: boolean;
  enabled: boolean;
  providers: EndpointProviderDto[];
  createdAt: string;
  updatedAt: string;
}

/** Returned once on create / token regeneration. */
export interface EndpointWithTokenDto extends EndpointDto {
  accessToken: string;
}

export interface RequestLogDto {
  id: number;
  endpointId: string | null;
  endpointName: string | null;
  sessionId: string | null;
  providerId: string | null;
  providerName: string | null;
  apiKeyId: string | null;
  apiKeyLabel: string | null;
  proxyId: string | null;
  toolName: string | null;
  method: string;
  status: LogStatus;
  latencyMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface SessionBindingDto {
  providerId: string;
  providerName: string;
  providerSlug: string;
  apiKeyId: string;
  apiKeyLabel: string;
  maskedKey: string;
  proxyId: string | null;
}

export interface SessionDto {
  id: string;
  endpointId: string;
  endpointName: string;
  endpointSlug: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  bindings: SessionBindingDto[];
}

export interface BulkKeysImportResult {
  created: number;
  skipped: number;
  errors: BulkLineError[];
  /** Inline proxies that did not exist yet and were added to the pool. */
  proxiesCreated: number;
}

export interface BulkProxiesImportResult {
  created: number;
  skipped: number;
  errors: BulkLineError[];
}

export interface AssignProxiesResult {
  /** Keys that received a proxy. */
  assigned: number;
  /** Targeted keys left without a proxy (only in `one_to_one` mode when proxies run out). */
  unassigned: number;
}

/** POST /api/providers/:id/refresh-tools */
export interface RefreshToolsResultDto {
  tools: McpToolDefinition[];
  toolsFetchedAt: string;
}

/** POST /api/keys/:id/test */
export interface KeyTestResultDto {
  ok: boolean;
  latencyMs: number;
  /** Number of tools returned by `tools/list`; null when the test failed. */
  toolCount: number | null;
  error: string | null;
}

/** POST /api/proxies/:id/check */
export interface ProxyCheckResultDto {
  proxyId: string;
  ok: boolean;
  status: ProxyStatus;
  /** Public IP address reported by the check service, as seen through the proxy. */
  exitIp: string | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

/** POST /api/proxies/check-all */
export interface ProxyCheckAllResultDto {
  total: number;
  ok: number;
  failed: number;
  results: ProxyCheckResultDto[];
}

/** GET /api/stats/overview. Keys in an expired cooldown count as active. */
export interface StatsOverviewDto {
  providers: { total: number; enabled: number };
  keys: KeyStats;
  proxies: { total: number; enabled: number; ok: number; failed: number; unknown: number };
  sessions: { active: number };
  requests24h: {
    total: number;
    ok: number;
    error: number;
    /** error / total, between 0 and 1 (0 when there were no requests). */
    errorRate: number;
  };
}
