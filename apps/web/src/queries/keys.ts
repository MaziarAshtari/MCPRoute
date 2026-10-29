import type {
  ApiKeyCreateInput,
  ApiKeyDto,
  ApiKeyUpdateInput,
  AssignProxiesInput,
  AssignProxiesResult,
  BulkKeysImportInput,
  BulkKeysImportResult,
  KeyTestResultDto,
} from '@mcproute/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from './query-keys';

/** Key changes affect provider key stats, proxy key counts and the dashboard. */
export async function invalidateKeyData(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.proxies }),
    queryClient.invalidateQueries({ queryKey: queryKeys.stats }),
  ]);
}

export function useProviderKeys(providerId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.providerKeys(providerId),
    queryFn: () => api<ApiKeyDto[]>(`/providers/${providerId}/keys`),
    enabled: enabled && providerId !== '',
  });
}

export function useCreateKey(providerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ApiKeyCreateInput) =>
      api<ApiKeyDto>(`/providers/${providerId}/keys`, { method: 'POST', body: input }),
    onSuccess: () => invalidateKeyData(queryClient),
    meta: { errorTitle: 'Could not add the key' },
  });
}

export function useBulkImportKeys(providerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkKeysImportInput) =>
      api<BulkKeysImportResult>(`/providers/${providerId}/keys/bulk`, { method: 'POST', body: input }),
    onSuccess: () => invalidateKeyData(queryClient),
    meta: { errorTitle: 'Bulk import failed' },
  });
}

export function useAssignProxies(providerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignProxiesInput) =>
      api<AssignProxiesResult>(`/providers/${providerId}/keys/assign-proxies`, { method: 'POST', body: input }),
    onSuccess: () => invalidateKeyData(queryClient),
    meta: { errorTitle: 'Could not assign proxies' },
  });
}

export function useUpdateKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ApiKeyUpdateInput }) =>
      api<ApiKeyDto>(`/keys/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateKeyData(queryClient),
    meta: { errorTitle: 'Could not update the key' },
  });
}

export function useDeleteKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateKeyData(queryClient),
    meta: { errorTitle: 'Could not delete the key' },
  });
}

export function testKey(id: string): Promise<KeyTestResultDto> {
  return api<KeyTestResultDto>(`/keys/${id}/test`, { method: 'POST' });
}
