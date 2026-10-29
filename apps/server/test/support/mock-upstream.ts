import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/** In-process upstream MCP server. The API key is read from `Authorization: Bearer <key>` or `?apiKey=`. */
export interface MockUpstream {
  /** Streamable HTTP endpoint. */
  url: string;
  /** Legacy SSE endpoint. */
  sseUrl: string;
  /** Keys answered with HTTP 429 on tools/call (the session itself still works). */
  rateLimitedKeys: Set<string>;
  /** Keys answered with HTTP 401 on every request. */
  revokedKeys: Set<string>;
  /** Keys whose `quota_check` call returns an isError "quota exceeded" result. */
  quotaKeys: Set<string>;
  /** Key of every upstream session that completed initialization. */
  initializations: string[];
  /** Every tool call that reached a tool handler. */
  calls: { key: string; tool: string }[];
  /** Upstream sessions terminated with DELETE. */
  terminated: number;
  reset(): void;
  close(): Promise<void>;
}

/**
 * How tools refer to the calling key. Upper-cased because MCPRoute masks the exact key in upstream results.
 */
export const keyAlias = (key: string) => key.toUpperCase();

type Headers = IncomingMessage['headers'] | Record<string, string | string[] | undefined>;

function keyOf(headers: Headers | undefined, url?: URL): string {
  const value = headers?.authorization;
  const header = Array.isArray(value) ? value[0] : value;
  return header?.replace(/^Bearer\s+/i, '') || url?.searchParams.get('apiKey') || '';
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

const isToolCall = (body: unknown) =>
  typeof body === 'object' && body !== null && (body as { method?: unknown }).method === 'tools/call';

export async function startMockUpstream(): Promise<MockUpstream> {
  const streamable = new Map<string, StreamableHTTPServerTransport>();
  const sse = new Map<string, SSEServerTransport>();

  const state: Omit<MockUpstream, 'url' | 'sseUrl' | 'reset' | 'close'> = {
    rateLimitedKeys: new Set(),
    revokedKeys: new Set(),
    quotaKeys: new Set(),
    initializations: [],
    calls: [],
    terminated: 0,
  };

  function buildServer(sessionKey: string): McpServer {
    const mcp = new McpServer({ name: 'mock-upstream', version: '1.0.0' });
    const record = (tool: string, extra: { requestInfo?: { headers: Headers; url?: URL } }) => {
      const key = keyOf(extra.requestInfo?.headers, extra.requestInfo?.url) || sessionKey;
      state.calls.push({ key, tool });
      return key;
    };
    mcp.registerTool('whoami', { description: 'Identifies the API key used for this call' }, async (extra) => ({
      content: [{ type: 'text', text: `key=${keyAlias(record('whoami', extra))}` }],
    }));
    mcp.registerTool('leak_key', { description: 'Echoes the raw API key (a misbehaving upstream)' }, async (extra) => ({
      content: [{ type: 'text', text: `your key is ${record('leak_key', extra)}` }],
    }));
    mcp.registerTool('echo', { description: 'Echoes the text', inputSchema: { text: z.string() } }, async ({ text }, extra) => {
      record('echo', extra);
      return { content: [{ type: 'text', text }] };
    });
    mcp.registerTool('quota_check', { description: 'Fails for keys out of quota' }, async (extra) => {
      const key = record('quota_check', extra);
      return state.quotaKeys.has(key)
        ? { content: [{ type: 'text', text: 'Monthly quota exceeded for this API key' }], isError: true }
        : { content: [{ type: 'text', text: `quota ok for ${keyAlias(key)}` }] };
    });
    mcp.registerTool('fail', { description: 'Always fails (not a key problem)' }, async (extra) => {
      record('fail', extra);
      return { content: [{ type: 'text', text: 'Something went wrong in the tool' }], isError: true };
    });
    mcp.registerTool('secret_tool', { description: 'Hidden by deny lists' }, async (extra) => {
      record('secret_tool', extra);
      return { content: [{ type: 'text', text: 'secret' }] };
    });
    mcp.registerPrompt(
      'greeting',
      { description: 'Greets someone', argsSchema: { name: z.string() } },
      ({ name }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Hello, ${name}!` } }] }),
    );
    mcp.registerResource('info', 'mock://info', { description: 'Static info', mimeType: 'text/plain' }, async (uri) => ({
      contents: [{ uri: uri.href, text: 'mock resource contents' }],
    }));
    mcp.server.oninitialized = () => state.initializations.push(sessionKey);
    return mcp;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const key = keyOf(req.headers, url);
    if (state.revokedKeys.has(key)) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"invalid api key"}');
      return;
    }

    if (url.pathname === '/mcp') {
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      if (isToolCall(body) && state.rateLimitedKeys.has(key)) {
        res.writeHead(429, { 'content-type': 'application/json' }).end('{"error":"rate limit exceeded"}');
        return;
      }
      const sessionId = req.headers['mcp-session-id'];
      let transport = typeof sessionId === 'string' ? streamable.get(sessionId) : undefined;
      if (!transport) {
        if (!isInitializeRequest(body)) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end('{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}');
          return;
        }
        const created = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => void streamable.set(id, created),
          onsessionclosed: (id) => {
            state.terminated += 1;
            streamable.delete(id);
          },
        });
        transport = created;
        await buildServer(key).connect(created);
      }
      await transport.handleRequest(req, res, body);
      return;
    }

    if (url.pathname === '/sse' && req.method === 'GET') {
      const transport = new SSEServerTransport('/messages', res);
      sse.set(transport.sessionId, transport);
      res.on('close', () => sse.delete(transport.sessionId));
      await buildServer(key).connect(transport);
      return;
    }

    if (url.pathname === '/messages' && req.method === 'POST') {
      const transport = sse.get(url.searchParams.get('sessionId') ?? '');
      const body = await readJson(req);
      if (!transport) {
        res.writeHead(404).end();
        return;
      }
      if (isToolCall(body) && state.rateLimitedKeys.has(key)) {
        res.writeHead(429).end('rate limit exceeded');
        return;
      }
      await transport.handlePostMessage(req, res, body);
      return;
    }

    res.writeHead(404).end();
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return Object.assign(state, {
    url: `http://127.0.0.1:${port}/mcp`,
    sseUrl: `http://127.0.0.1:${port}/sse`,
    reset() {
      state.rateLimitedKeys.clear();
      state.revokedKeys.clear();
      state.quotaKeys.clear();
      state.initializations.length = 0;
      state.calls.length = 0;
      state.terminated = 0;
    },
    async close() {
      await Promise.allSettled([...streamable.values(), ...sse.values()].map((transport) => transport.close()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  });
}
