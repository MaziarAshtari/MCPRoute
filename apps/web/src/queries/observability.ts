import type {
  Paginated,
  RequestLogDto,
  RequestTimeseriesDto,
  SessionDto,
  StatsOverviewDto,
} from '@mcproute/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys, type LogFilters, type SessionFilters } from './query-keys';

export function useStatsOverview() {
  return useQuery({
    queryKey: queryKeys.statsOverview,
    queryFn: () => api<StatsOverviewDto>('/stats/overview'),
    refetchInterval: 30_000,
  });
}

export function useStatsTimeseries(hours = 24) {
  return useQuery({
    queryKey: queryKeys.statsTimeseries(hours),
    queryFn: () => api<RequestTimeseriesDto>('/stats/timeseries', { query: { hours } }),
    refetchInterval: 60_000,
  });
}

export function useLogs(filters: LogFilters, autoRefresh: boolean) {
  return useQuery({
    queryKey: queryKeys.logList(filters),
    queryFn: () => api<Paginated<RequestLogDto>>('/logs', { query: { ...filters } }),
    placeholderData: keepPreviousData,
    refetchInterval: autoRefresh ? 5_000 : false,
  });
}

export function useSessions(filters: SessionFilters) {
  return useQuery({
    queryKey: queryKeys.sessionList(filters),
    queryFn: () => api<Paginated<SessionDto>>('/sessions', { query: { ...filters } }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stats }),
      ]);
    },
    meta: { errorTitle: 'Could not terminate the session' },
  });
}
