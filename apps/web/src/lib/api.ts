import type { ApiErrorBody } from '@mcproute/shared';

export interface ApiIssue {
  path: string;
  message: string;
}

/** Error thrown for non-2xx API responses (status 0 when the server could not be reached). */
export class ApiError extends Error {
  readonly status: number;
  readonly issues: ApiIssue[];

  constructor(status: number, message: string, issues: ApiIssue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** One-line, user-facing description of an error, including the first validation issue. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const issue = error.issues[0];
    if (!issue) return error.message;
    return `${issue.path ? `${issue.path}: ` : ''}${issue.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

let unauthorizedHandler: (() => void) | null = null;

/** Called for every 401 response except the login request itself. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Calls the admin REST API under /api (same origin, session cookie). */
export async function api<T>(path: string, { method = 'GET', body, query, signal }: RequestOptions = {}): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const queryString = search.toString();

  let response: Response;
  try {
    response = await fetch(`/api${path}${queryString ? `?${queryString}` : ''}`, {
      method,
      signal,
      credentials: 'same-origin',
      // Fastify rejects an empty body declared as JSON, so the header is only sent with a body.
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, 'Cannot reach the MCPRoute server');
  }

  if (response.status === 401 && path !== '/auth/login') unauthorizedHandler?.();
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? parseJson(text) : undefined;
  if (!response.ok) {
    const body = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      response.status,
      body.message ?? (response.statusText || `Request failed with status ${response.status}`),
      body.issues ?? [],
    );
  }
  return data as T;
}
