import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { vi } from 'vitest';
import { AppProviders } from '@/app-providers';
import { connectUnauthorizedHandler, createQueryClient } from '@/lib/query-client';
import { routes } from '@/routes';

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
}

/** A static JSON body (status 200) or a handler; keys look like "GET /api/providers". */
export type MockRoutes = Record<string, unknown | ((request: MockRequest) => MockResponse)>;

function response({ status = 200, body }: MockResponse): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => text,
    json: async () => body,
  } as Response;
}

/** Replaces fetch with an in-memory admin API and records every request. */
export function mockApi(routes: MockRoutes) {
  const requests: MockRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
      const request: MockRequest = {
        method: (init?.method ?? 'GET').toUpperCase(),
        path: url.pathname,
        query: url.searchParams,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      requests.push(request);
      const route = routes[`${request.method} ${request.path}`];
      if (route === undefined) {
        return response({ status: 404, body: { statusCode: 404, error: 'Not Found', message: `No mock for ${request.method} ${request.path}` } });
      }
      return response(typeof route === 'function' ? route(request) : { body: route });
    }),
  );
  return {
    requests,
    requestsTo: (method: string, path: string) => requests.filter((request) => request.method === method && request.path === path),
  };
}

/** Renders the whole app (providers, routes, layout) at `path` with a fresh query client. */
export function renderApp(path: string) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  connectUnauthorizedHandler(queryClient);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router, queryClient };
}
