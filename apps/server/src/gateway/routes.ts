import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { SLUG_PATTERN } from '@mcproute/shared';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { EndpointRow } from '../db/schema';
import { safeEqual, sha256Hex } from '../lib/crypto';
import { errorBody } from '../lib/errors';
import type { Gateway } from './gateway';
import type { GatewaySession } from './session';

/** Same limit the SDK applies when it reads bodies itself. */
const MCP_BODY_LIMIT = 4 * 1024 * 1024;

interface Authenticated {
  endpoint: EndpointRow;
  token: string;
  tokenSource: 'header' | 'query';
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `Authorization: Bearer <token>`, or `?token=<token>` for clients that cannot set headers. */
function extractToken(request: FastifyRequest): { token: string; source: 'header' | 'query' } | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(headerValue(request.headers.authorization) ?? '');
  if (match?.[1]) return { token: match[1], source: 'header' };
  const query = request.query as Record<string, unknown> | undefined;
  const token = query?.token;
  return typeof token === 'string' && token !== '' ? { token, source: 'query' } : null;
}

/** 404 for unknown or disabled endpoints, 401 for a missing or wrong token. */
function authenticate(gateway: Gateway, request: FastifyRequest, reply: FastifyReply): Authenticated | null {
  const { slug } = request.params as { slug: string };
  const endpoint = SLUG_PATTERN.test(slug) ? gateway.findEndpointBySlug(slug) : null;
  if (!endpoint || !endpoint.enabled) {
    void reply.code(404).send(errorBody(404, 'MCP endpoint not found'));
    return null;
  }
  const credentials = extractToken(request);
  // Hashes are compared in constant time (safeEqual hashes both sides again, so lengths never leak).
  if (!credentials || !safeEqual(sha256Hex(credentials.token), endpoint.accessTokenHash)) {
    request.log.warn({ endpointId: endpoint.id, ip: request.ip }, 'MCP request with an invalid access token');
    void reply
      .code(401)
      .header('www-authenticate', 'Bearer realm="mcproute"')
      .send(errorBody(401, 'Missing or invalid access token'));
    return null;
  }
  return { endpoint, token: credentials.token, tokenSource: credentials.source };
}

function sendJsonRpcError(reply: FastifyReply, statusCode: number, code: number, message: string) {
  return reply.code(statusCode).send({ jsonrpc: '2.0', error: { code, message }, id: null });
}

function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  let url: URL;
  try {
    url = new URL(request.url, `${request.protocol}://${request.host || 'localhost'}`);
  } catch {
    // Only informational for MCP handlers; a malformed Host header must not fail the request.
    url = new URL(request.url, 'http://localhost');
  }
  return new Request(url, { method: request.method, headers });
}

/** Streams a web Response to the client; SSE bodies are flushed event by event, never buffered. */
async function sendWebResponse(reply: FastifyReply, response: Response): Promise<void> {
  reply.hijack();
  const res = reply.raw;
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  res.flushHeaders();
  try {
    // A client disconnect destroys the pipeline, which cancels the stream inside the SDK transport.
    await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), res);
  } catch {
    if (!res.destroyed) res.destroy();
  }
}

function isInitializeBody(body: unknown): boolean {
  return Array.isArray(body) ? body.some((message) => isInitializeRequest(message)) : isInitializeRequest(body);
}

async function handleStreamableHttp(gateway: Gateway, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = authenticate(gateway, request, reply);
  if (!auth) return;

  const sessionId = headerValue(request.headers['mcp-session-id']);
  if (!sessionId) {
    if (request.method !== 'POST' || !isInitializeBody(request.body)) {
      await sendJsonRpcError(reply, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
      return;
    }
    const session = gateway.createStreamableSession(auth.endpoint);
    const response = await session.webTransport.handleRequest(toWebRequest(request), { parsedBody: request.body });
    // Registered before the response (and with it the session id) reaches the client.
    if (session.initialized) gateway.registerSession(session);
    else void session.close();
    await sendWebResponse(reply, response);
    return;
  }

  const session = await gateway.findSession(sessionId, auth.endpoint);
  if (!session || !gateway.touch(session)) {
    await sendJsonRpcError(reply, 404, -32001, 'Session not found');
    return;
  }
  // Only POSTs count as in flight: a GET stream may stay open for the whole session.
  const tracked = request.method === 'POST';
  if (tracked) session.inFlight += 1;
  try {
    const response = await session.webTransport.handleRequest(toWebRequest(request), { parsedBody: request.body });
    await sendWebResponse(reply, response);
  } finally {
    if (tracked) session.inFlight -= 1;
  }
}

async function handleSseStream(gateway: Gateway, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = authenticate(gateway, request, reply);
  if (!auth) return;
  if (!auth.endpoint.enableSse) {
    await reply.code(404).send(errorBody(404, 'SSE transport is not enabled for this endpoint'));
    return;
  }
  // Clients authenticating with ?token= cannot add headers to their POSTs either.
  const query = auth.tokenSource === 'query' ? `?token=${encodeURIComponent(auth.token)}` : '';
  reply.hijack();
  const res = reply.raw;
  res.setHeader('X-Accel-Buffering', 'no');
  const transport = new SSEServerTransport(`/mcp/${auth.endpoint.slug}/messages${query}`, res);
  let session: GatewaySession;
  try {
    session = await gateway.openSseSession(auth.endpoint, transport);
  } catch (error) {
    request.log.error({ err: error }, 'Could not open SSE session');
    if (!res.headersSent) res.writeHead(500).end();
    else res.end();
    return;
  }
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');
  }, gateway.options.keepAliveMs);
  keepAlive.unref();
  res.once('close', () => clearInterval(keepAlive));
  request.log.debug({ sessionId: session.id }, 'SSE stream opened');
}

async function handleSseMessage(gateway: Gateway, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = authenticate(gateway, request, reply);
  if (!auth) return;
  const { sessionId } = request.query as { sessionId?: unknown };
  const session = typeof sessionId === 'string' ? gateway.liveSession(sessionId) : undefined;
  if (!auth.endpoint.enableSse || !session || session.kind !== 'sse' || session.endpointId !== auth.endpoint.id) {
    await reply.code(404).send(errorBody(404, 'Session not found'));
    return;
  }
  if (!gateway.touch(session)) {
    await reply.code(404).send(errorBody(404, 'Session not found'));
    return;
  }
  reply.hijack();
  await session.sseTransport.handlePostMessage(request.raw, reply.raw, request.body);
}

/**
 * /mcp/{slug}: Streamable HTTP (POST, GET, DELETE) and, when enabled per endpoint, the legacy SSE transport
 * (GET /mcp/{slug}/sse + POST /mcp/{slug}/messages).
 */
export function mcpRoutes(gateway: Gateway): FastifyPluginAsync {
  return async (app) => {
    const streamable = (request: FastifyRequest, reply: FastifyReply) => handleStreamableHttp(gateway, request, reply);
    app.post('/mcp/:slug', { bodyLimit: MCP_BODY_LIMIT }, streamable);
    // No automatic HEAD route: it would open an SSE stream.
    app.get('/mcp/:slug', { exposeHeadRoute: false }, streamable);
    app.delete('/mcp/:slug', streamable);
    app.get('/mcp/:slug/sse', { exposeHeadRoute: false }, (request, reply) => handleSseStream(gateway, request, reply));
    app.post('/mcp/:slug/messages', { bodyLimit: MCP_BODY_LIMIT }, (request, reply) =>
      handleSseMessage(gateway, request, reply),
    );
  };
}
