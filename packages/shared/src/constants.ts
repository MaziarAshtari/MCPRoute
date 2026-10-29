export const APP_NAME = 'MCPRoute';
export const APP_VERSION = '0.2.0';

/** Placeholder replaced with the bound API key in provider URLs, headers, args and env values. */
export const API_KEY_PLACEHOLDER = '{{API_KEY}}';

/** Separates the provider slug from the upstream name when an endpoint uses `toolPrefixMode: "provider_slug"`. */
export const TOOL_PREFIX_SEPARATOR = '__';

export const TRANSPORTS = ['streamable_http', 'sse', 'stdio'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const AUTH_MODES = ['header', 'query', 'url_placeholder', 'env'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const ROTATION_STRATEGIES = ['round_robin', 'random', 'least_used'] as const;
export type RotationStrategy = (typeof ROTATION_STRATEGIES)[number];

export const KEY_STATUSES = ['active', 'cooldown', 'disabled'] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];

export const PROXY_STATUSES = ['unknown', 'ok', 'failed'] as const;
export type ProxyStatus = (typeof PROXY_STATUSES)[number];

export const PROXY_SCHEMES = ['http', 'https', 'socks5', 'socks5h'] as const;
export type ProxyScheme = (typeof PROXY_SCHEMES)[number];

/** Schemes selectable as the default for bulk-imported proxies written without a scheme. */
export const DEFAULT_PROXY_SCHEMES = ['http', 'socks5'] as const;
export type DefaultProxyScheme = (typeof DEFAULT_PROXY_SCHEMES)[number];

export const TOOL_PREFIX_MODES = ['none', 'provider_slug'] as const;
export type ToolPrefixMode = (typeof TOOL_PREFIX_MODES)[number];

export const TOOL_FILTER_MODES = ['all', 'allowlist', 'denylist'] as const;
export type ToolFilterMode = (typeof TOOL_FILTER_MODES)[number];

export const LOG_STATUSES = ['ok', 'error'] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

export const PROXY_ASSIGN_MODES = ['round_robin', 'random', 'one_to_one'] as const;
export type ProxyAssignMode = (typeof PROXY_ASSIGN_MODES)[number];

/** Upstream responses that count as a key failure (and trigger cooldown / failover). */
export interface FailureRules {
  /** HTTP status codes returned by the upstream server. */
  httpStatuses: number[];
  /** Regular expression sources, matched case-insensitively against error messages. */
  messagePatterns: string[];
}

export function defaultFailureRules(): FailureRules {
  return {
    httpStatuses: [401, 402, 403, 429],
    messagePatterns: ['rate limit|quota|credit|insufficient'],
  };
}

export const PROVIDER_DEFAULTS = {
  transport: 'streamable_http',
  authHeaderName: 'Authorization',
  authValueTemplate: `Bearer ${API_KEY_PLACEHOLDER}`,
  rotationStrategy: 'round_robin',
  failoverEnabled: true,
  cooldownSeconds: 300,
} as const;

export const API_KEY_MAX_LENGTH = 4096;
export const LABEL_MAX_LENGTH = 100;
export const BULK_IMPORT_MAX_LINES = 10_000;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
