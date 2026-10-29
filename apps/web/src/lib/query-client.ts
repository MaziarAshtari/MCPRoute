import { MutationCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '@/queries/query-keys';
import { ApiError, errorMessage, isUnauthorized, setUnauthorizedHandler } from './api';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Title of the error toast shown when the mutation fails. */
      errorTitle?: string;
      /** The caller reports errors itself. */
      silent?: boolean;
    };
  }
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _result, mutation) => {
        if (mutation.meta?.silent || isUnauthorized(error)) return;
        toast.error(mutation.meta?.errorTitle ?? 'Something went wrong', { description: errorMessage(error) });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Client errors (404, 400, ...) will not succeed on retry.
        retry: (failureCount, error) =>
          failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
      mutations: { retry: false },
    },
  });
}

/** Any 401 signs the UI out; the protected layout then redirects to the login page. */
export function connectUnauthorizedHandler(client: QueryClient): () => void {
  setUnauthorizedHandler(() => {
    const wasSignedIn = client.getQueryData(queryKeys.me) != null;
    client.setQueryData(queryKeys.me, null);
    if (wasSignedIn) {
      toast.error('Your session has expired', { id: 'session-expired', description: 'Sign in again to continue.' });
    }
  });
  return () => setUnauthorizedHandler(null);
}
