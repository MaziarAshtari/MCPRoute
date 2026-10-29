export interface LogFilters {
  page: number;
  pageSize: number;
  endpointId?: string;
  providerId?: string;
  apiKeyId?: string;
  status?: 'ok' | 'error';
  from?: string;
  to?: string;
}

export interface SessionFilters {
  page: number;
  pageSize: number;
  endpointId?: string;
}

/** Hierarchical keys: invalidating ['providers'] also refreshes provider details and their keys. */
export const queryKeys = {
  me: ['auth', 'me'] as const,
  stats: ['stats'] as const,
  statsOverview: ['stats', 'overview'] as const,
  statsTimeseries: (hours: number) => ['stats', 'timeseries', hours] as const,
  providers: ['providers'] as const,
  provider: (id: string) => ['providers', id] as const,
  providerKeys: (id: string) => ['providers', id, 'keys'] as const,
  proxies: ['proxies'] as const,
  endpoints: ['endpoints'] as const,
  endpoint: (id: string) => ['endpoints', id] as const,
  sessions: ['sessions'] as const,
  sessionList: (filters: SessionFilters) => ['sessions', filters] as const,
  logs: ['logs'] as const,
  logList: (filters: LogFilters) => ['logs', filters] as const,
};
