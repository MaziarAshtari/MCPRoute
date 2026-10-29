import {
  parseProxyUrl,
  redactProxyUrl,
  type ApiKeyDto,
  type EndpointDto,
  type EndpointProviderDto,
  type KeyStats,
  type ProviderDto,
  type ProxyDto,
  type ProxyRefDto,
} from '@mcproute/shared';
import type { ApiKeyRow, EndpointRow, ProviderRow, ProxyRow } from '../db/schema';

/** Row -> API response mappers. They decide exactly which fields leave the server. */

export const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export const EMPTY_KEY_STATS: KeyStats = { total: 0, enabled: 0, active: 0, cooldown: 0, disabled: 0 };

export function toProviderDto(row: ProviderRow, keyStats: KeyStats = EMPTY_KEY_STATS): ProviderDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    transport: row.transport,
    url: row.url,
    command: row.command,
    args: row.args,
    env: row.env,
    authMode: row.authMode,
    authHeaderName: row.authHeaderName,
    authValueTemplate: row.authValueTemplate,
    authQueryParam: row.authQueryParam,
    rotationStrategy: row.rotationStrategy,
    failoverEnabled: row.failoverEnabled,
    cooldownSeconds: row.cooldownSeconds,
    failureRules: row.failureRules,
    cachedTools: row.cachedTools,
    toolsFetchedAt: iso(row.toolsFetchedAt),
    enabled: row.enabled,
    keyStats,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProxyRefDto(row: ProxyRow): ProxyRefDto {
  return { id: row.id, label: row.label, url: redactProxyUrl(row.url), status: row.status, enabled: row.enabled };
}

export function toProxyDto(row: ProxyRow, keyCount: number): ProxyDto {
  const parsed = parseProxyUrl(row.url);
  const details = parsed.ok ? parsed.proxy : null;
  return {
    id: row.id,
    label: row.label,
    url: redactProxyUrl(row.url),
    scheme: details?.scheme ?? 'http',
    host: details?.host ?? '',
    port: details?.port ?? 0,
    username: details?.username ?? null,
    hasPassword: details?.password != null,
    enabled: row.enabled,
    status: row.status,
    lastCheckedAt: iso(row.lastCheckedAt),
    lastLatencyMs: row.lastLatencyMs,
    lastExitIp: row.lastExitIp,
    lastError: row.lastError,
    keyCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toApiKeyDto(row: ApiKeyRow, proxy: ProxyRow | null): ApiKeyDto {
  return {
    id: row.id,
    providerId: row.providerId,
    label: row.label,
    maskedKey: row.keyMask,
    proxyId: row.proxyId,
    proxy: proxy ? toProxyRefDto(proxy) : null,
    enabled: row.enabled,
    weight: row.weight,
    status: row.status,
    cooldownUntil: iso(row.cooldownUntil),
    usageCount: row.usageCount,
    errorCount: row.errorCount,
    activeSessions: row.activeSessions,
    lastUsedAt: iso(row.lastUsedAt),
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEndpointDto(row: EndpointRow, providers: EndpointProviderDto[]): EndpointDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    mcpPath: `/mcp/${row.slug}`,
    accessTokenHint: row.accessTokenHint,
    toolPrefixMode: row.toolPrefixMode,
    enableSse: row.enableSse,
    enabled: row.enabled,
    providers,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
