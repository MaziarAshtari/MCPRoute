import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiKeys, providers, requestLogs, sessionBindings, sessions } from '../src/db/schema';
import { createTestContext, type TestContext } from './helpers';
import { keyAlias, startMockUpstream, type MockUpstream } from './support/mock-upstream';
import { startHttpProxy, startSocksProxy } from './support/proxies';

const MOCK_TOOLS = ['whoami', 'leak_key', 'echo', 'quota_check', 'fail', 'secret_tool'];
/** Expected `whoami` output for a key. */
const who = (key: string) => `key=${keyAlias(key)}`;
const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } },
};
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

let upstream: MockUpstream;
let t: TestContext;
let baseUrl: string;
const clients: Client[] = [];

beforeAll(async () => {
  upstream = await startMockUpstream();
});
afterAll(async () => {
  await upstream.close();
});
beforeEach(async () => {
  upstream.reset();
  t = await createTestContext();
  baseUrl = await t.listen();
});
afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await t.close();
});

async function createProvider(overrides: Record<string, unknown> = {}) {
  const res = await t.api('POST', '/api/providers', { name: 'Mock', transport: 'streamable_http', url: upstream.url, ...overrides });
  expect(res.statusCode, res.body).toBe(201);
  return res.json as { id: string; slug: string };
}

async function addKeys(providerId: string, keys: string[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const key of keys) {
    const res = await t.api('POST', `/api/providers/${providerId}/keys`, { key, label: key });
    expect(res.statusCode, res.body).toBe(201);
    ids[key] = res.json.id;
  }
  return ids;
}

async function createEndpoint(links: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  const res = await t.api('POST', '/api/endpoints', { name: 'Research', ...overrides });
  expect(res.statusCode, res.body).toBe(201);
  const linked = await t.api('PUT', `/api/endpoints/${res.json.id}/providers`, { providers: links });
  expect(linked.statusCode, linked.body).toBe(200);
  return { id: res.json.id as string, slug: res.json.slug as string, token: res.json.accessToken as string };
}

/** Provider "Mock" with the given keys, linked to a new endpoint. */
async function setup(keys: string[], provider: Record<string, unknown> = {}, endpoint: Record<string, unknown> = {}) {
  const created = await createProvider(provider);
  const keyIds = await addKeys(created.id, keys);
  return { provider: created, keyIds, endpoint: await createEndpoint([{ providerId: created.id }], endpoint) };
}

async function connect(slug: string, token: string, via: 'header' | 'query' = 'header'): Promise<Client> {
  const url = new URL(`/mcp/${slug}`, baseUrl);
  if (via === 'query') url.searchParams.set('token', token);
  const transport = new StreamableHTTPClientTransport(
    url,
    via === 'header' ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined,
  );
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  clients.push(client);
  return client;
}

const textOf = (result: unknown) => (result as { content: { text?: string }[] }).content[0]?.text;
const call = async (client: Client, name: string, args?: Record<string, unknown>) =>
  textOf(await client.callTool({ name, arguments: args }));
const toolNames = async (client: Client) => (await client.listTools()).tools.map((tool) => tool.name);
const keyRow = (id: string | undefined) => t.database.db.select().from(apiKeys).where(eq(apiKeys.id, id ?? '')).get();
const logRows = () => t.database.db.select().from(requestLogs).orderBy(asc(requestLogs.id)).all();

describe('endpoint authentication', () => {
  it('accepts the access token as a Bearer header or a ?token= query parameter', async () => {
    const { endpoint } = await setup(['key-alpha-0001']);
    for (const via of ['header', 'query'] as const) {
      const client = await connect(endpoint.slug, endpoint.token, via);
      expect(await toolNames(client)).toEqual(MOCK_TOOLS);
      expect(await call(client, 'whoami')).toBe(who('key-alpha-0001'));
    }
    // The token passed in the URL never reaches the logs.
    expect(t.logs.join('')).toContain('token=[REDACTED]');
    expect(t.logs.join('')).not.toContain(endpoint.token);
  });

  it('answers 401 for a missing or wrong token, 404 for unknown or disabled endpoints and sessions', async () => {
    const endpoint = await createEndpoint([]);
    const post = (path: string, headers: Record<string, string> = {}, body: unknown = INIT) =>
      fetch(new URL(path, baseUrl), { method: 'POST', headers: { ...MCP_HEADERS, ...headers }, body: JSON.stringify(body) });
    const auth = { authorization: `Bearer ${endpoint.token}` };

    expect((await post(`/mcp/${endpoint.slug}`)).status).toBe(401);
    const wrong = await post(`/mcp/${endpoint.slug}`, { authorization: 'Bearer mcpr_wrong' });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('www-authenticate')).toMatch(/^Bearer/);
    expect((await post(`/mcp/${endpoint.slug}?token=mcpr_wrong`)).status).toBe(401);
    expect((await post('/mcp/no-such-endpoint', auth)).status).toBe(404);

    const ok = await post(`/mcp/${endpoint.slug}`, auth);
    expect(ok.status).toBe(200);
    const sessionId = ok.headers.get('mcp-session-id');
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    await ok.text();
    expect(t.database.db.select().from(sessions).all().map((row) => row.id)).toEqual([sessionId]);

    const list = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
    expect((await post(`/mcp/${endpoint.slug}`, auth, list)).status).toBe(400);
    expect((await post(`/mcp/${endpoint.slug}`, { ...auth, 'mcp-session-id': 'unknown-session' }, list)).status).toBe(404);
    const listed = await post(`/mcp/${endpoint.slug}`, { ...auth, 'mcp-session-id': sessionId ?? '' }, list);
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain('"tools":[]');

    await t.api('PATCH', `/api/endpoints/${endpoint.id}`, { enabled: false });
    expect((await post(`/mcp/${endpoint.slug}`, auth)).status).toBe(404);
  });
});

describe('session affinity', () => {
  it('keeps one key per session and rotates keys across sessions (round_robin)', async () => {
    const { provider, keyIds, endpoint } = await setup(['key-alpha-0001', 'key-bravo-0002']);
    const first = await connect(endpoint.slug, endpoint.token);
    const second = await connect(endpoint.slug, endpoint.token);

    for (let i = 0; i < 3; i += 1) expect(await call(first, 'whoami')).toBe(who('key-alpha-0001'));
    expect(await call(second, 'whoami')).toBe(who('key-bravo-0002'));
    expect(await call(second, 'echo', { text: 'hi' })).toBe('hi');
    expect(await call(first, 'whoami')).toBe(who('key-alpha-0001'));

    // One upstream connection per (session, provider), reused for every call.
    expect([...upstream.initializations].sort()).toEqual(['key-alpha-0001', 'key-bravo-0002']);
    const bindings = t.database.db.select().from(sessionBindings).all();
    expect(bindings.map((binding) => binding.apiKeyId).sort()).toEqual(Object.values(keyIds).sort());

    const keys = (await t.api('GET', `/api/providers/${provider.id}/keys`)).json;
    expect(keys.map((key: Record<string, unknown>) => [key.label, key.activeSessions, key.usageCount])).toEqual([
      ['key-alpha-0001', 1, 4],
      ['key-bravo-0002', 1, 2],
    ]);
    expect(keys[0].lastUsedAt).not.toBeNull();

    const logs = logRows();
    expect(logs).toHaveLength(6);
    expect(logs.every((log) => log.method === 'tools/call' && log.status === 'ok' && log.latencyMs !== null)).toBe(true);
    expect(logs[0]).toMatchObject({ endpointId: endpoint.id, providerId: provider.id, apiKeyId: keyIds['key-alpha-0001'] });
    expect(logs.map((log) => log.toolName)).toEqual(['whoami', 'whoami', 'whoami', 'whoami', 'echo', 'whoami']);
  });

  it('restores a persisted session after a restart and keeps its key binding', async () => {
    const { keyIds, endpoint } = await setup(['key-alpha-0001', 'key-bravo-0002']);
    const first = await connect(endpoint.slug, endpoint.token);
    const second = await connect(endpoint.slug, endpoint.token);
    expect(await call(first, 'whoami')).toBe(who('key-alpha-0001'));
    expect(await call(second, 'whoami')).toBe(who('key-bravo-0002'));

    // Restart: a new app on the same port and database; in-memory state (and round-robin position) is gone.
    const port = Number(new URL(baseUrl).port);
    await t.app.close();
    const restarted = await createTestContext({}, { database: t.database });
    try {
      await restarted.app.listen({ host: '127.0.0.1', port });
      expect(await call(second, 'whoami')).toBe(who('key-bravo-0002'));
      expect(await call(second, 'echo', { text: 'still here' })).toBe('still here');
      expect(upstream.initializations).toEqual(['key-alpha-0001', 'key-bravo-0002', 'key-bravo-0002']);
      expect(keyRow(keyIds['key-bravo-0002'])?.activeSessions).toBe(1);
      expect(restarted.logs.join('')).toContain('MCP session restored');
    } finally {
      await restarted.close();
    }
  });

  it('expires idle sessions, closing upstream sessions and releasing keys', async () => {
    const { keyIds, endpoint } = await setup(['key-alpha-0001']);
    const client = await connect(endpoint.slug, endpoint.token);
    expect(await call(client, 'whoami')).toBe(who('key-alpha-0001'));
    expect(keyRow(keyIds['key-alpha-0001'])?.activeSessions).toBe(1);

    const { db } = t.database;
    db.update(sessions).set({ expiresAt: new Date(Date.now() - 1_000) }).run();
    t.gateway.runMaintenance();

    expect(db.select().from(sessions).all()).toHaveLength(0);
    expect(db.select().from(sessionBindings).all()).toHaveLength(0);
    expect(keyRow(keyIds['key-alpha-0001'])?.activeSessions).toBe(0);
    expect(t.gateway.liveSessionCount).toBe(0);
    await vi.waitFor(() => expect(upstream.terminated).toBe(1));
    await expect(client.callTool({ name: 'whoami' })).rejects.toThrow(/Session not found/);
  });

  it('ends live sessions deleted through the admin API', async () => {
    const { endpoint } = await setup(['key-alpha-0001']);
    const client = await connect(endpoint.slug, endpoint.token);
    await call(client, 'whoami');
    const [row] = t.database.db.select().from(sessions).all();
    expect((await t.api('DELETE', `/api/sessions/${row?.id}`)).statusCode).toBe(204);
    expect(t.gateway.liveSessionCount).toBe(0);
    await expect(client.callTool({ name: 'whoami' })).rejects.toThrow(/Session not found/);
  });
});

describe('tool aggregation', () => {
  async function twoProviders(endpoint: Record<string, unknown>, alphaLink = {}, betaLink = {}) {
    const alpha = await createProvider({ name: 'Alpha' });
    const beta = await createProvider({ name: 'Beta' });
    await addKeys(alpha.id, ['alpha-key-0001']);
    await addKeys(beta.id, ['beta-key-0001']);
    const created = await createEndpoint(
      [
        { providerId: beta.id, ...betaLink },
        { providerId: alpha.id, ...alphaLink },
      ],
      endpoint,
    );
    return connect(created.slug, created.token);
  }

  it('prefixes tool names with the provider slug and routes calls by prefix', async () => {
    const client = await twoProviders({ toolPrefixMode: 'provider_slug' });
    expect(await toolNames(client)).toEqual([
      ...MOCK_TOOLS.map((name) => `alpha__${name}`),
      ...MOCK_TOOLS.map((name) => `beta__${name}`),
    ]);
    expect(await call(client, 'alpha__whoami')).toBe(who('alpha-key-0001'));
    expect(await call(client, 'beta__whoami')).toBe(who('beta-key-0001'));
    expect(await call(client, 'beta__echo', { text: 'routed' })).toBe('routed');
    await expect(client.callTool({ name: 'whoami' })).rejects.toThrow(/Unknown tool: whoami/);
    await expect(client.callTool({ name: 'gamma__whoami' })).rejects.toThrow(/Unknown tool/);
    expect(logRows().map((log) => log.toolName)).toEqual(['whoami', 'whoami', 'echo']);
  });

  it('without prefixes, lets the first provider (by name) win name collisions', async () => {
    const client = await twoProviders({ toolPrefixMode: 'none' });
    expect(await toolNames(client)).toEqual(MOCK_TOOLS);
    expect(await call(client, 'whoami')).toBe(who('alpha-key-0001'));
  });

  it('applies allowlist and denylist filters to listing and calls', async () => {
    const client = await twoProviders(
      { toolPrefixMode: 'provider_slug' },
      { toolFilterMode: 'allowlist', toolNames: ['whoami', 'echo'] },
      { toolFilterMode: 'denylist', toolNames: ['secret_tool', 'beta__fail'] },
    );
    expect(await toolNames(client)).toEqual([
      'alpha__whoami',
      'alpha__echo',
      'beta__whoami',
      'beta__leak_key',
      'beta__echo',
      'beta__quota_check',
    ]);
    for (const name of ['alpha__secret_tool', 'alpha__fail', 'beta__secret_tool', 'beta__fail']) {
      await expect(client.callTool({ name })).rejects.toThrow(/Unknown tool/);
    }
    expect(await call(client, 'alpha__echo', { text: 'allowed' })).toBe('allowed');
    expect(upstream.calls.map((entry) => entry.tool)).toEqual(['echo']);
  });

  it('serves tools/list from the provider cache and refreshes stale caches in the background', async () => {
    const { provider, endpoint } = await setup(['key-alpha-0001']);
    const cached = [{ name: 'cached_tool', description: 'From the cache', inputSchema: { type: 'object' } }];
    const { db } = t.database;
    db.update(providers).set({ cachedTools: cached, toolsFetchedAt: new Date() }).where(eq(providers.id, provider.id)).run();

    const client = await connect(endpoint.slug, endpoint.token);
    expect(await toolNames(client)).toEqual(['cached_tool']);
    expect(upstream.initializations).toHaveLength(0);

    db.update(providers)
      .set({ toolsFetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(providers.id, provider.id))
      .run();
    expect(await toolNames(client)).toEqual(['cached_tool']);
    await vi.waitFor(() => {
      const row = db.select().from(providers).where(eq(providers.id, provider.id)).get();
      expect(row?.cachedTools?.map((tool) => tool.name)).toEqual(MOCK_TOOLS);
    });
    expect(await toolNames(client)).toEqual(MOCK_TOOLS);
    // The background refresh does not bind a key to the session.
    expect(db.select().from(sessionBindings).all()).toHaveLength(0);
  });

  it('forwards prompts and resources, prefixing their names', async () => {
    const { endpoint } = await setup(['key-alpha-0001'], {}, { toolPrefixMode: 'provider_slug' });
    const client = await connect(endpoint.slug, endpoint.token);

    expect((await client.listPrompts()).prompts.map((prompt) => prompt.name)).toEqual(['mock__greeting']);
    const prompt = await client.getPrompt({ name: 'mock__greeting', arguments: { name: 'Ada' } });
    expect(prompt.messages[0]?.content).toEqual({ type: 'text', text: 'Hello, Ada!' });

    const { resources } = await client.listResources();
    expect(resources).toEqual([expect.objectContaining({ uri: 'mock://info', name: 'mock__info' })]);
    const read = await client.readResource({ uri: 'mock://info' });
    expect(read.contents[0]).toMatchObject({ uri: 'mock://info', text: 'mock resource contents' });
    await expect(client.readResource({ uri: 'mock://missing' })).rejects.toThrow();

    expect(logRows().map((log) => [log.method, log.toolName, log.status])).toEqual([
      ['prompts/get', 'greeting', 'ok'],
      ['resources/read', 'mock://info', 'ok'],
      ['resources/read', 'mock://missing', 'error'],
    ]);
  });
});

describe('failover', () => {
  it('cools down a key answered with HTTP 429 and retries the call with another key', async () => {
    const { keyIds, endpoint } = await setup(['key-alpha-0001', 'key-bravo-0002'], { cooldownSeconds: 120 });
    const alphaId = keyIds['key-alpha-0001'];
    const bravoId = keyIds['key-bravo-0002'];
    const client = await connect(endpoint.slug, endpoint.token);
    expect(await call(client, 'whoami')).toBe(who('key-alpha-0001'));

    upstream.rateLimitedKeys.add('key-alpha-0001');
    expect(await call(client, 'whoami')).toBe(who('key-bravo-0002'));

    const alpha = (await t.api('GET', `/api/keys/${alphaId}`)).json;
    expect(alpha).toMatchObject({ status: 'cooldown', errorCount: 1, activeSessions: 0 });
    expect(alpha.lastError).toMatch(/429/);
    expect(Date.parse(alpha.cooldownUntil) - Date.now()).toBeGreaterThan(110_000);
    expect((await t.api('GET', `/api/keys/${bravoId}`)).json).toMatchObject({ status: 'active', activeSessions: 1 });
    expect(t.database.db.select().from(sessionBindings).all().map((binding) => binding.apiKeyId)).toEqual([bravoId]);

    const logs = logRows();
    expect(logs.map((log) => [log.apiKeyId, log.status])).toEqual([
      [alphaId, 'ok'],
      [alphaId, 'error'],
      [bravoId, 'ok'],
    ]);
    expect(logs[1]?.errorMessage).toMatch(/429/);

    // The session stays on the new key; new sessions skip the cooling key.
    expect(await call(client, 'whoami')).toBe(who('key-bravo-0002'));
    const other = await connect(endpoint.slug, endpoint.token);
    expect(await call(other, 'whoami')).toBe(who('key-bravo-0002'));
    expect(upstream.calls.filter((entry) => entry.key === 'key-alpha-0001')).toHaveLength(1);
  });

  it('fails over when an isError tool result matches the failure patterns', async () => {
    const { keyIds, endpoint } = await setup(['key-alpha-0001', 'key-bravo-0002']);
    upstream.quotaKeys.add('key-alpha-0001');
    const client = await connect(endpoint.slug, endpoint.token);
    expect(await call(client, 'quota_check')).toBe(`quota ok for ${keyAlias('key-bravo-0002')}`);
    expect(keyRow(keyIds['key-alpha-0001'])).toMatchObject({ status: 'cooldown', errorCount: 1 });
    expect(logRows().map((log) => [log.status, log.errorMessage])).toEqual([
      ['error', 'Monthly quota exceeded for this API key'],
      ['ok', null],
    ]);
  });

  it('stops after three attempts and returns the last error', async () => {
    const keys = ['key-alpha-0001', 'key-bravo-0002', 'key-charlie-03', 'key-delta-0004'];
    const { keyIds, endpoint } = await setup(keys);
    for (const key of keys) upstream.rateLimitedKeys.add(key);
    const client = await connect(endpoint.slug, endpoint.token);
    const result = await client.callTool({ name: 'whoami' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/429/);
    expect(keys.map((key) => keyRow(keyIds[key])?.status)).toEqual(['cooldown', 'cooldown', 'cooldown', 'active']);
    expect(logRows()).toHaveLength(3);
  });

  it('returns non-key errors as-is without failover', async () => {
    const { keyIds, endpoint } = await setup(['key-alpha-0001', 'key-bravo-0002']);
    const client = await connect(endpoint.slug, endpoint.token);
    const result = await client.callTool({ name: 'fail' });
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Something went wrong in the tool' }] });
    expect(keyRow(keyIds['key-alpha-0001'])).toMatchObject({ status: 'active', errorCount: 0 });
    expect(logRows().map((log) => [log.status, log.errorMessage])).toEqual([['error', 'Something went wrong in the tool']]);
    expect(upstream.calls).toHaveLength(1);
  });

  it('keeps the binding when failover is disabled', async () => {
    const { keyIds, endpoint } = await setup(['key-alpha-0001', 'key-bravo-0002'], { failoverEnabled: false });
    upstream.rateLimitedKeys.add('key-alpha-0001');
    const client = await connect(endpoint.slug, endpoint.token);
    const result = await client.callTool({ name: 'whoami' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/429/);
    expect(keyRow(keyIds['key-alpha-0001'])?.status).toBe('cooldown');
    expect(t.database.db.select().from(sessionBindings).all().map((binding) => binding.apiKeyId)).toEqual([
      keyIds['key-alpha-0001'],
    ]);
  });

  it('returns a tool error when no key is available', async () => {
    const { provider, keyIds, endpoint } = await setup(['key-alpha-0001']);
    await t.api('PATCH', `/api/keys/${keyIds['key-alpha-0001']}`, { enabled: false });
    const client = await connect(endpoint.slug, endpoint.token);
    const result = await client.callTool({ name: 'whoami' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no API key is available for provider "Mock"/);
    expect(logRows()).toEqual([expect.objectContaining({ providerId: provider.id, apiKeyId: null, status: 'error' })]);
    expect(upstream.initializations).toHaveLength(0);
  });
});

describe('upstream connections', () => {
  it('connects to legacy SSE upstreams', async () => {
    const { endpoint } = await setup(['key-alpha-0001'], { transport: 'sse', url: upstream.sseUrl });
    const client = await connect(endpoint.slug, endpoint.token);
    expect(await call(client, 'whoami')).toBe(who('key-alpha-0001'));
  });

  it('masks the API key when an upstream result echoes it', async () => {
    const { endpoint } = await setup(['key-alpha-0001']);
    const client = await connect(endpoint.slug, endpoint.token);
    expect(await call(client, 'leak_key')).toBe('your key is ****');
  });

  it('places the key in the query string or URL (URL-encoded)', async () => {
    const key = 'key+with/special=chars';
    const viaQuery = await setup([key], { name: 'Query', url: upstream.url, authMode: 'query', authQueryParam: 'apiKey' });
    expect(await call(await connect(viaQuery.endpoint.slug, viaQuery.endpoint.token), 'whoami')).toBe(who(key));
    const viaUrl = await setup([key], { name: 'Placeholder', url: `${upstream.url}?apiKey={{API_KEY}}` }, { name: 'Other' });
    expect(await call(await connect(viaUrl.endpoint.slug, viaUrl.endpoint.token), 'whoami')).toBe(who(key));
  });

  it("routes each key through its own HTTP or SOCKS5 proxy", async () => {
    const httpProxy = await startHttpProxy({ username: 'alice', password: 'p@ss:word' });
    const socksProxy = await startSocksProxy({ username: 'bob', password: 'socks-secret' });
    try {
      const provider = await createProvider();
      const imported = await t.api('POST', `/api/providers/${provider.id}/keys/bulk`, {
        text: `key-http-0001|${httpProxy.url}\nkey-socks-0002|${socksProxy.url}`,
      });
      expect(imported.json).toMatchObject({ created: 2, proxiesCreated: 2, errors: [] });
      const endpoint = await createEndpoint([{ providerId: provider.id }]);
      const upstreamHost = new URL(upstream.url).host;

      expect(await call(await connect(endpoint.slug, endpoint.token), 'whoami')).toBe(who('key-http-0001'));
      expect(await call(await connect(endpoint.slug, endpoint.token), 'whoami')).toBe(who('key-socks-0002'));
      expect(httpProxy.destinations).toContain(upstreamHost);
      expect(socksProxy.destinations).toContain(upstreamHost);
      expect(httpProxy.authFailures + socksProxy.authFailures).toBe(0);
      expect(logRows().every((log) => log.proxyId !== null)).toBe(true);
    } finally {
      await httpProxy.close();
      await socksProxy.close();
    }
  });
});

describe('legacy SSE transport', () => {
  it('serves /sse and /messages when enabled, with header or query token', async () => {
    const { endpoint } = await setup(['key-alpha-0001'], {}, { enableSse: true });
    const viaHeader = new SSEClientTransport(new URL(`/mcp/${endpoint.slug}/sse`, baseUrl), {
      requestInit: { headers: { Authorization: `Bearer ${endpoint.token}` } },
    });
    const viaQuery = new SSEClientTransport(new URL(`/mcp/${endpoint.slug}/sse?token=${endpoint.token}`, baseUrl));
    for (const transport of [viaHeader, viaQuery]) {
      const client = new Client({ name: 'sse-client', version: '1.0.0' });
      let t0 = performance.now();
      await client.connect(transport);
      console.log('connect', performance.now() - t0); t0 = performance.now();
      expect(await call(client, 'whoami')).toBe(who('key-alpha-0001'));
      console.log('call', performance.now() - t0); t0 = performance.now();
      expect(t.database.db.select().from(sessions).all()).toHaveLength(1);
      await client.close();
      console.log('close', performance.now() - t0); t0 = performance.now();
      await vi.waitFor(() => expect(t.database.db.select().from(sessions).all()).toHaveLength(0));
      console.log('waitFor', performance.now() - t0);
    }
  });

  it('is not exposed unless enabled', async () => {
    const { endpoint } = await setup(['key-alpha-0001']);
    const res = await fetch(new URL(`/mcp/${endpoint.slug}/sse`, baseUrl), {
      headers: { authorization: `Bearer ${endpoint.token}`, accept: 'text/event-stream' },
    });
    expect(res.status).toBe(404);
  });
});

describe('SSE keep-alive', () => {
  it('sends comment pings on idle Streamable HTTP and legacy SSE streams', async () => {
    const fast = await createTestContext({}, { gateway: { keepAliveMs: 50 } });
    try {
      const fastUrl = await fast.listen();
      const endpoint = (await fast.api('POST', '/api/endpoints', { name: 'Pings', enableSse: true })).json;
      const auth = { authorization: `Bearer ${endpoint.accessToken}` };

      const readUntilPing = async (res: Response) => {
        expect(res.headers.get('content-type')).toBe('text/event-stream');
        expect(res.headers.get('x-accel-buffering')).toBe('no');
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        let received = '';
        while (!received.includes(': keepalive')) {
          const { value, done } = await reader.read();
          if (done) break;
          received += new TextDecoder().decode(value);
        }
        await reader.cancel();
        return received;
      };

      const legacy = await fetch(new URL(`/mcp/${endpoint.slug}/sse`, fastUrl), { headers: { ...auth, accept: 'text/event-stream' } });
      expect(await readUntilPing(legacy)).toMatch(/^event: endpoint\n/);

      const init = await fetch(new URL(`/mcp/${endpoint.slug}`, fastUrl), {
        method: 'POST',
        headers: { ...MCP_HEADERS, ...auth },
        body: JSON.stringify(INIT),
      });
      const sessionId = init.headers.get('mcp-session-id') ?? '';
      await init.text();
      const stream = await fetch(new URL(`/mcp/${endpoint.slug}`, fastUrl), {
        headers: { ...auth, accept: 'text/event-stream', 'mcp-session-id': sessionId },
      });
      expect(stream.status).toBe(200);
      expect(await readUntilPing(stream)).toContain(': keepalive');
    } finally {
      await fast.close();
    }
  });
});
