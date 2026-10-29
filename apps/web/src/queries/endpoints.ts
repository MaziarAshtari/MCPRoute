import type {
  EndpointCreateInput,
  EndpointDto,
  EndpointUpdateInput,
  EndpointWithTokenDto,
  SetEndpointProvidersInput,
} from '@mcproute/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from './query-keys';

export function useEndpoints() {
  return useQuery({ queryKey: queryKeys.endpoints, queryFn: () => api<EndpointDto[]>('/endpoints') });
}

export function useEndpoint(id: string) {
  return useQuery({ queryKey: queryKeys.endpoint(id), queryFn: () => api<EndpointDto>(`/endpoints/${id}`) });
}

export function createEndpoint(input: EndpointCreateInput): Promise<EndpointWithTokenDto> {
  return api<EndpointWithTokenDto>('/endpoints', { method: 'POST', body: input });
}

export function updateEndpoint(id: string, input: EndpointUpdateInput): Promise<EndpointDto> {
  return api<EndpointDto>(`/endpoints/${id}`, { method: 'PATCH', body: input });
}

export function setEndpointProviders(id: string, input: SetEndpointProvidersInput): Promise<EndpointDto> {
  return api<EndpointDto>(`/endpoints/${id}/providers`, { method: 'PUT', body: input });
}

export function useUpdateEndpoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EndpointUpdateInput }) => updateEndpoint(id, input),
    onSuccess: (endpoint) => {
      queryClient.setQueryData(queryKeys.endpoint(endpoint.id), endpoint);
      return queryClient.invalidateQueries({ queryKey: queryKeys.endpoints });
    },
    meta: { errorTitle: 'Could not update the endpoint' },
  });
}

export function useRegenerateToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<EndpointWithTokenDto>(`/endpoints/${id}/regenerate-token`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.endpoints }),
    meta: { errorTitle: 'Could not regenerate the token' },
  });
}

export function useDeleteEndpoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/endpoints/${id}`, { method: 'DELETE' }),
    onSuccess: async (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.endpoint(id) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.endpoints }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stats }),
      ]);
    },
    meta: { errorTitle: 'Could not delete the endpoint' },
  });
}
