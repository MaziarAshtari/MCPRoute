import { isIP } from 'node:net';
import { parseProxyUrl, type ParsedProxy } from '@mcproute/shared';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { socksDispatcher } from 'fetch-socks';
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { safeErrorText } from '../lib/redact';

function parseOrThrow(proxyUrl: string): ParsedProxy {
  const parsed = parseProxyUrl(proxyUrl);
  if (!parsed.ok) throw new Error(`Invalid proxy URL: ${parsed.error}`);
  return parsed.proxy;
}

/** Proxy password, so it can be masked in error messages. */
export function proxyPassword(proxyUrl: string | null): string | null {
  if (!proxyUrl) return null;
  const parsed = parseProxyUrl(proxyUrl);
  return parsed.ok ? parsed.proxy.password : null;
}

/**
 * undici dispatcher that sends requests through the proxy: HTTP CONNECT tunnels for http/https proxies,
 * fetch-socks for socks5/socks5h. SOCKS connections always let the proxy resolve hostnames.
 */
export function createProxyDispatcher(proxyUrl: string, connectTimeoutMs: number): Dispatcher {
  const proxy = parseOrThrow(proxyUrl);
  if (proxy.scheme === 'socks5' || proxy.scheme === 'socks5h') {
    return socksDispatcher(
      {
        type: 5,
        host: proxy.host.replace(/^\[(.*)\]$/, '$1'),
        port: proxy.port,
        ...(proxy.username !== null ? { userId: proxy.username, password: proxy.password ?? '' } : {}),
      },
      { connect: { timeout: connectTimeoutMs } },
    );
  }
  // ProxyAgent only reads credentials from the URI when both parts are set, so build the header here.
  const token =
    proxy.username === null
      ? undefined
      : `Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64')}`;
  return new ProxyAgent({
    uri: `${proxy.scheme}://${proxy.host}:${proxy.port}`,
    ...(token ? { token } : {}),
    proxyTls: { timeout: connectTimeoutMs },
    requestTls: { timeout: connectTimeoutMs },
  });
}

export function createDirectDispatcher(connectTimeoutMs: number): Dispatcher {
  return new Agent({ connect: { timeout: connectTimeoutMs } });
}

/**
 * fetch bound to a dispatcher. undici's own fetch is used (not the global one) so the dispatcher
 * always comes from the same undici version as the fetch implementation.
 */
export function fetchWithDispatcher(dispatcher: Dispatcher): FetchLike {
  const bound = (url: string | URL, init?: RequestInit) =>
    undiciFetch(url, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher });
  return bound as unknown as FetchLike;
}

/**
 * Environment for stdio providers whose key has a proxy. Best effort: only programs that honour these
 * variables are proxied (Node.js >= 24 needs NODE_USE_ENV_PROXY, and only for http(s) proxies).
 */
export function proxyEnvironment(proxyUrl: string): Record<string, string> {
  const proxy = parseOrThrow(proxyUrl);
  const env: Record<string, string> = {};
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
    env[name] = proxy.url;
    env[name.toLowerCase()] = proxy.url;
  }
  if (proxy.scheme === 'http' || proxy.scheme === 'https') env.NODE_USE_ENV_PROXY = '1';
  return env;
}

export interface ProxyCheckOutcome {
  ok: boolean;
  exitIp: string | null;
  latencyMs: number;
  error: string | null;
}

/** Fetches `checkUrl` (by default api.ipify.org) through the proxy and reports the exit IP. */
export async function checkProxy(proxyUrl: string, checkUrl: string, timeoutMs: number): Promise<ProxyCheckOutcome> {
  const started = performance.now();
  let dispatcher: Dispatcher | undefined;
  try {
    dispatcher = createProxyDispatcher(proxyUrl, timeoutMs);
    const response = await undiciFetch(checkUrl, {
      dispatcher,
      headers: { accept: 'application/json, text/plain' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await response.text()).trim();
    if (!response.ok) throw new Error(`Check service answered HTTP ${response.status}`);
    let candidate: unknown = body;
    try {
      candidate = (JSON.parse(body) as { ip?: unknown }).ip;
    } catch {
      // Plain-text services return the bare address.
    }
    const exitIp = typeof candidate === 'string' && isIP(candidate.trim()) !== 0 ? candidate.trim() : null;
    return { ok: true, exitIp, latencyMs: Math.round(performance.now() - started), error: null };
  } catch (error) {
    return {
      ok: false,
      exitIp: null,
      latencyMs: Math.round(performance.now() - started),
      error: safeErrorText(error, [proxyPassword(proxyUrl)]),
    };
  } finally {
    void dispatcher?.destroy().catch(() => undefined);
  }
}
