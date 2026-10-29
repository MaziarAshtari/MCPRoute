import { API_KEY_PLACEHOLDER, APP_VERSION, type McpToolDefinition } from '@mcproute/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Prompt, Resource, ResourceTemplate } from '@modelcontextprotocol/sdk/types.js';
import type { FastifyBaseLogger } from 'fastify';
import type { Dispatcher } from 'undici';
import type { ProviderRow } from '../db/schema';
import { redactSecrets } from '../lib/redact';
import { createProxyDispatcher, fetchWithDispatcher, proxyEnvironment, proxyPassword } from './proxy';

const TERMINATE_TIMEOUT_MS = 3_000;
const MAX_LIST_PAGES = 100;

export interface UpstreamTarget {
  provider: ProviderRow;
  /** Plaintext API key. */
  apiKey: string;
  /** Canonical proxy URL (with credentials), or null for a direct connection. */
  proxyUrl: string | null;
}

export interface UpstreamSettings {
  connectTimeoutMs: number;
  /** Shared dispatcher for keys without a proxy. */
  directDispatcher: Dispatcher;
  logger: FastifyBaseLogger;
}

export interface UpstreamConnection {
  readonly client: Client;
  /** Values to mask in anything derived from this connection (key, URL-encoded key, proxy password). */
  readonly secrets: readonly string[];
  /** True once the connection is closed, including when the upstream went away on its own. */
  readonly closed: boolean;
  /** `terminate` also ends the upstream Streamable HTTP session (DELETE). */
  close(options?: { terminate?: boolean }): Promise<void>;
}

export function connectionSecrets(apiKey: string, proxyUrl: string | null): string[] {
  return [apiKey, encodeURIComponent(apiKey), proxyPassword(proxyUrl)].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );
}

const substitute = (template: string, apiKey: string) => template.replaceAll(API_KEY_PLACEHOLDER, apiKey);

/** URL and headers for HTTP transports, with the key placed according to `authMode`. */
export function httpTarget(provider: ProviderRow, apiKey: string): { url: URL; headers: Record<string, string> } {
  if (!provider.url) throw new Error(`Provider "${provider.slug}" has no URL`);
  // Encoded so keys containing URL syntax (+, /, =, &) survive inside a path segment or query value.
  const url = new URL(provider.url.replaceAll(API_KEY_PLACEHOLDER, encodeURIComponent(apiKey)));
  const headers: Record<string, string> = {};
  if (provider.authMode === 'header') headers[provider.authHeaderName] = substitute(provider.authValueTemplate, apiKey);
  if (provider.authMode === 'query' && provider.authQueryParam) url.searchParams.set(provider.authQueryParam, apiKey);
  return { url, headers };
}

/** Command line for stdio providers: `{{API_KEY}}` is substituted in args and env, proxy variables added. */
export function stdioParams(provider: ProviderRow, apiKey: string, proxyUrl: string | null) {
  if (!provider.command) throw new Error(`Provider "${provider.slug}" has no command`);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(provider.env ?? {})) env[name] = substitute(value, apiKey);
  if (proxyUrl) Object.assign(env, proxyEnvironment(proxyUrl));
  return { command: provider.command, args: (provider.args ?? []).map((arg) => substitute(arg, apiKey)), env };
}

/** Opens an MCP client session to the provider with one key, through that key's proxy. */
export async function connectUpstream(target: UpstreamTarget, settings: UpstreamSettings): Promise<UpstreamConnection> {
  const { provider, apiKey, proxyUrl } = target;
  const secrets = connectionSecrets(apiKey, proxyUrl);
  let dispatcher: Dispatcher | undefined;
  let transport: Transport;

  if (provider.transport === 'stdio') {
    // The child only inherits a minimal environment (PATH, HOME, ...) plus the provider's env.
    const stdio = new StdioClientTransport({ ...stdioParams(provider, apiKey, proxyUrl), stderr: 'pipe' });
    // Must be consumed, or a chatty server blocks once the pipe buffer fills up.
    stdio.stderr?.on('data', (chunk: Buffer) => {
      const text = redactSecrets(chunk.toString('utf8'), secrets).trimEnd();
      if (text) settings.logger.debug({ providerId: provider.id }, `[stdio] ${text.slice(0, 2_000)}`);
    });
    transport = stdio;
  } else {
    if (proxyUrl) dispatcher = createProxyDispatcher(proxyUrl, settings.connectTimeoutMs);
    const fetch = fetchWithDispatcher(dispatcher ?? settings.directDispatcher);
    const { url, headers } = httpTarget(provider, apiKey);
    transport =
      provider.transport === 'sse'
        ? new SSEClientTransport(url, { requestInit: { headers }, fetch })
        : new StreamableHTTPClientTransport(url, { requestInit: { headers }, fetch });
  }

  const client = new Client({ name: 'mcproute', version: APP_VERSION });
  let closed = false;
  client.onclose = () => {
    closed = true;
  };
  const release = async () => {
    await client.close().catch(() => undefined);
    await dispatcher?.destroy().catch(() => undefined);
  };

  try {
    await client.connect(transport, { timeout: settings.connectTimeoutMs });
  } catch (error) {
    await release();
    throw error;
  }

  return {
    client,
    secrets,
    get closed() {
      return closed;
    },
    async close({ terminate = false } = {}) {
      if (terminate && !closed && transport instanceof StreamableHTTPClientTransport) {
        await Promise.race([
          transport.terminateSession().catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, TERMINATE_TIMEOUT_MS).unref()),
        ]);
      }
      closed = true;
      await release();
    },
  };
}

async function collectPages<T>(fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string }>) {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return items;
}

export function listAllTools(client: Client, options?: RequestOptions): Promise<McpToolDefinition[]> {
  return collectPages(async (cursor) => {
    const result = await client.listTools(cursor ? { cursor } : undefined, options);
    return { items: result.tools as McpToolDefinition[], nextCursor: result.nextCursor };
  });
}

export function listAllPrompts(client: Client, options?: RequestOptions): Promise<Prompt[]> {
  return collectPages(async (cursor) => {
    const result = await client.listPrompts(cursor ? { cursor } : undefined, options);
    return { items: result.prompts, nextCursor: result.nextCursor };
  });
}

export function listAllResources(client: Client, options?: RequestOptions): Promise<Resource[]> {
  return collectPages(async (cursor) => {
    const result = await client.listResources(cursor ? { cursor } : undefined, options);
    return { items: result.resources, nextCursor: result.nextCursor };
  });
}

export function listAllResourceTemplates(client: Client, options?: RequestOptions): Promise<ResourceTemplate[]> {
  return collectPages(async (cursor) => {
    const result = await client.listResourceTemplates(cursor ? { cursor } : undefined, options);
    return { items: result.resourceTemplates, nextCursor: result.nextCursor };
  });
}
