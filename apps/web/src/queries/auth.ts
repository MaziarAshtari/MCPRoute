import type { AdminSessionDto, LoginInput } from '@mcproute/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from './query-keys';

/** The current admin session, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async (): Promise<AdminSessionDto | null> => {
      try {
        return await api<AdminSessionDto>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api<AdminSessionDto>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (session) => queryClient.setQueryData(queryKeys.me, session),
    meta: { silent: true },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    meta: { errorTitle: 'Could not sign out' },
  });
}
