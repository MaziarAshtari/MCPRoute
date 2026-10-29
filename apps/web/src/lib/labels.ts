import type {
  AuthMode,
  ProxyAssignMode,
  ProxyStatus,
  RotationStrategy,
  ToolFilterMode,
  ToolPrefixMode,
  Transport,
} from '@mcproute/shared';

export const TRANSPORT_LABELS: Record<Transport, string> = {
  streamable_http: 'Streamable HTTP',
  sse: 'HTTP + SSE (legacy)',
  stdio: 'stdio (local command)',
};

export const TRANSPORT_SHORT_LABELS: Record<Transport, string> = {
  streamable_http: 'HTTP',
  sse: 'SSE',
  stdio: 'stdio',
};

export const AUTH_MODE_LABELS: Record<AuthMode, string> = {
  header: 'HTTP header',
  query: 'Query parameter',
  url_placeholder: 'URL placeholder',
  env: 'Environment / arguments',
};

export const ROTATION_LABELS: Record<RotationStrategy, string> = {
  round_robin: 'Round robin',
  random: 'Random',
  least_used: 'Least used',
};

export const ROTATION_DESCRIPTIONS: Record<RotationStrategy, string> = {
  round_robin: 'Weighted round robin: a key with weight 3 is picked three times as often.',
  random: 'Weighted random choice for every new session.',
  least_used: 'The key with the fewest bound sessions per unit of weight.',
};

export const ASSIGN_MODE_LABELS: Record<ProxyAssignMode, { label: string; description: string }> = {
  round_robin: { label: 'Round robin', description: 'Spread the keys evenly across the proxies.' },
  random: { label: 'Random', description: 'Pick a random proxy for each key.' },
  one_to_one: {
    label: 'One to one',
    description: 'Each proxy serves at most one key of this provider; extra keys stay without a proxy.',
  },
};

export const TOOL_FILTER_LABELS: Record<ToolFilterMode, string> = {
  all: 'All tools',
  allowlist: 'Only selected tools',
  denylist: 'All except selected',
};

export const TOOL_PREFIX_LABELS: Record<ToolPrefixMode, { label: string; description: string }> = {
  none: { label: 'No prefix', description: 'Tools keep their upstream names; on a clash the first provider wins.' },
  provider_slug: {
    label: 'Provider slug',
    description: 'Tools are exposed as {provider}__{tool}, so names never clash.',
  },
};

export const PROXY_STATUS_DOT: Record<ProxyStatus, string> = {
  ok: 'bg-emerald-500',
  failed: 'bg-red-500',
  unknown: 'bg-muted-foreground/50',
};

/** Drops the `user:****@` part of a (masked) proxy URL. */
export function stripCredentials(url: string): string {
  return url.replace(/\/\/[^@/]*@/, '//');
}

export function proxyDisplayName(proxy: { label: string | null; url: string }): string {
  return proxy.label || stripCredentials(proxy.url);
}
