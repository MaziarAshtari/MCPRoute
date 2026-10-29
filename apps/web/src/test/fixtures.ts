import {
  PROVIDER_DEFAULTS,
  defaultFailureRules,
  type AdminSessionDto,
  type ApiKeyDto,
  type ProviderDto,
} from '@mcproute/shared';

export const ADMIN_SESSION: AdminSessionDto = { username: 'admin', expiresAt: '2030-01-01T00:00:00.000Z' };

const TIMESTAMP = '2026-10-01T12:00:00.000Z';

export function providerDto(overrides: Partial<ProviderDto> = {}): ProviderDto {
  return {
    id: '3b241101-e2bb-4255-8caf-4136c566a962',
    name: 'Exa',
    slug: 'exa',
    description: null,
    transport: 'streamable_http',
    url: 'https://mcp.exa.ai/mcp?exaApiKey={{API_KEY}}',
    command: null,
    args: null,
    env: null,
    authMode: 'url_placeholder',
    authHeaderName: PROVIDER_DEFAULTS.authHeaderName,
    authValueTemplate: PROVIDER_DEFAULTS.authValueTemplate,
    authQueryParam: null,
    rotationStrategy: 'round_robin',
    failoverEnabled: true,
    cooldownSeconds: 300,
    failureRules: defaultFailureRules(),
    cachedTools: null,
    toolsFetchedAt: null,
    enabled: true,
    keyStats: { total: 0, enabled: 0, active: 0, cooldown: 0, disabled: 0 },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

export function apiKeyDto(overrides: Partial<ApiKeyDto> = {}): ApiKeyDto {
  return {
    id: '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b',
    providerId: '3b241101-e2bb-4255-8caf-4136c566a962',
    label: 'sk-l****0001',
    maskedKey: 'sk-l****0001',
    proxyId: null,
    proxy: null,
    enabled: true,
    weight: 1,
    status: 'active',
    cooldownUntil: null,
    usageCount: 0,
    errorCount: 0,
    activeSessions: 0,
    lastUsedAt: null,
    lastError: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}
