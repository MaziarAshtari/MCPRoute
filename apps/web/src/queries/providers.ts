import type { ProviderConfig, ProviderDto, ProviderUpdateInput, RefreshToolsResultDto } from '@mcproute/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from './query-keys';

export function useProviders() {
  return useQuery({ queryKey: queryKeys.providers, queryFn: () => api<ProviderDto[]>('/providers') });
}

export function useProvider(id: string) {
  return useQuery({ queryKey: queryKeys.provider(id), queryFn: () => api<ProviderDto>(`/providers/${id}`) });
}

export function useCreateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProviderConfig) => api<ProviderDto>('/providers', { method: 'POST', body: input }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stats }),
      ]);
    },
    meta: { errorTitle: 'Could not create the provider' },
  });
}

export function useUpdateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProviderUpdateInput }) =>
      api<ProviderDto>(`/providers/${id}`, { method: 'PATCH', body: input }),
    onSuccess: async (provider) => {
      queryClient.setQueryData(queryKeys.provider(provider.id), provider);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.endpoints }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stats }),
      ]);
    },
    meta: { errorTitle: 'Could not update the provider' },
  });
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/providers/${id}`, { method: 'DELETE' }),
    onSuccess: async (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.provider(id) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.endpoints }),
        queryClient.invalidateQueries({ queryKey: queryKeys.proxies }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stats }),
      ]);
    },
    meta: { errorTitle: 'Could not delete the provider' },
  });
}

export function useRefreshTools() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<RefreshToolsResultDto>(`/providers/${id}/refresh-tools`, { method: 'POST' }),
    onSuccess: async (_result, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.provider(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.providers, exact: true }),
      ]);
    },
    meta: { errorTitle: 'Could not refresh tools' },
  });
}
