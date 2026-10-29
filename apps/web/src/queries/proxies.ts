import type {
  BulkProxiesImportInput,
  BulkProxiesImportResult,
  ProxyCheckResultDto,
  ProxyDto,
  ProxyUpdateInput,
} from '@mcproute/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from './query-keys';

/** Proxies are embedded in key rows, so key lists refresh too. */
export async function invalidateProxyData(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.proxies }),
    queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.stats }),
  ]);
}

export function useProxies() {
  return useQuery({ queryKey: queryKeys.proxies, queryFn: () => api<ProxyDto[]>('/proxies') });
}

export function useBulkImportProxies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkProxiesImportInput) =>
      api<BulkProxiesImportResult>('/proxies/bulk', { method: 'POST', body: input }),
    onSuccess: () => invalidateProxyData(queryClient),
    meta: { errorTitle: 'Proxy import failed' },
  });
}

export function useUpdateProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProxyUpdateInput }) =>
      api<ProxyDto>(`/proxies/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateProxyData(queryClient),
    meta: { errorTitle: 'Could not update the proxy' },
  });
}

export function useDeleteProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/proxies/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateProxyData(queryClient),
    meta: { errorTitle: 'Could not delete the proxy' },
  });
}

export function checkProxy(id: string): Promise<ProxyCheckResultDto> {
  return api<ProxyCheckResultDto>(`/proxies/${id}/check`, { method: 'POST' });
}
