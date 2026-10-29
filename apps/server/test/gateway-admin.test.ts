import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { apiKeys, endpoints, providers, proxies, requestLogs, sessions } from '../src/db/schema';
import { createTestContext, type TestContext } from './helpers';
import { startMockUpstream, type MockUpstream } from './support/mock-upstream';
import { startHttpProxy, startIpEcho, startSocksProxy } from './support/proxies';

const MOCK_TOOLS = ['whoami', 'leak_key', 'echo', 'quota_check', 'fail', 'secret_tool'];
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

let upstream: MockUpstream;
let ipEcho: Awaited<ReturnType<typeof startIpEcho>>;
let t: TestContext;

beforeAll(async () => {
  upstream = await startMockUpstream();
  ipEcho = await startIpEcho('203.0.113.7');
});
afterAll(async () => {
  await upstream.close();
  await ipEcho.close();
});
beforeEach(async () => {
  upstream.reset();
  t = await createTestContext({ PROXY_CHECK_URL: ipEcho.url, UPSTREAM_CONNECT_TIMEOUT_MS: '2000' });
});
afterEach(async () => {
  await t.close();
});

async function createProvider(overrides: Record<string, unknown> = {}) {
  const res = await t.api('POST', '/api/providers', { name: 'Mock', transport: 'streamable_http', url: upstream.url, ...overrides });
  expect(res.statusCode, res.body).toBe(201);
  return res.json as { id: string };
}

async function addKey(providerId: string, key: string, extra: Record<string, unknown> = {}) {
  const res = await t.api('POST', `/api/providers/${providerId}/keys`, { key, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json as { id: string };
}

/** A local port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('POST /api/providers/:id/refresh-tools', () => {
  it('fetches tools/list with an available key and stores the cache', async () => {
    const provider = await createProvider();
    const noKey = await t.api('POST', `/api/providers/${provider.id}/refresh-tools`);
    expect(noKey.statusCode).toBe(409);
    expect(noKey.json.message).toMatch(/no API key is available/);

    await addKey(provider.id, 'key-alpha-0001');
    const res = await t.api('POST', `/api/providers/${provider.id}/refresh-tools`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json.tools.map((tool: { name: string }) => tool.name)).toEqual(MOCK_TOOLS);
    expect(res.json.tools[2]).toMatchObject({ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } });
    const stored = (await t.api('GET', `/api/providers/${provider.id}`)).json;
    expect(stored.cachedTools).toEqual(res.json.tools);
    expect(stored.toolsFetchedAt).toBe(res.json.toolsFetchedAt);
    expect(upstream.terminated).toBe(1);

    upstream.revokedKeys.add('key-alpha-0001');
    const failed = await t.api('POST', `/api/providers/${provider.id}/refresh-tools`);
    expect(failed.statusCode).toBe(502);
    expect(failed.json.message).toMatch(/HTTP 401/);
    expect(failed.body).not.toContain('key-alpha-0001');
    expect((await t.api('POST', `/api/providers/${UNKNOWN_ID}/refresh-tools`)).statusCode).toBe(404);
  });
});

describe('POST /api/keys/:id/test', () => {
  it('connects with the key through its proxy and reports the result', async () => {
    const proxy = await startHttpProxy();
    try {
      const provider = await createProvider();
      const proxyRow = (await t.api('POST', '/api/proxies', { url: proxy.url })).json;
      const key = await addKey(provider.id, 'key-alpha-0001', { proxyId: proxyRow.id, enabled: false });

      const ok = await t.api('POST', `/api/keys/${key.id}/test`);
      expect(ok.json).toEqual({ ok: true, latencyMs: expect.any(Number), toolCount: MOCK_TOOLS.length, error: null });
      expect(proxy.destinations).toContain(new URL(upstream.url).host);
      expect(upstream.initializations).toEqual(['key-alpha-0001']);

      upstream.revokedKeys.add('key-alpha-0001');
      const failed = await t.api('POST', `/api/keys/${key.id}/test`);
      expect(failed.json).toMatchObject({ ok: false, toolCount: null, error: expect.stringMatching(/HTTP 401/) });
      expect(failed.body).not.toContain('key-alpha-0001');
      // Testing is read-only: no stats, cooldowns or sessions.
      expect((await t.api('GET', `/api/keys/${key.id}`)).json).toMatchObject({ status: 'active', errorCount: 0, usageCount: 0 });
      expect((await t.api('POST', `/api/keys/${UNKNOWN_ID}/test`)).statusCode).toBe(404);
    } finally {
      await proxy.close();
    }
  });
});

describe('proxy health checks', () => {
  it('requests the check URL through each proxy and stores status, latency and errors', async () => {
    const http = await startHttpProxy({ username: 'carol', password: 'proxy-secret' });
    const socks = await startSocksProxy({ username: 'dave', password: 'socks-secret' });
    try {
      const httpRow = (await t.api('POST', '/api/proxies', { url: http.url })).json;
      const socksRow = (await t.api('POST', '/api/proxies', { url: socks.url })).json;
      const deadRow = (await t.api('POST', '/api/proxies', { url: `http://user:dead-secret@127.0.0.1:${await closedPort()}` })).json;

      const single = await t.api('POST', `/api/proxies/${httpRow.id}/check`);
      expect(single.json).toEqual({
        proxyId: httpRow.id,
        ok: true,
        status: 'ok',
        exitIp: '203.0.113.7',
        latencyMs: expect.any(Number),
        error: null,
        checkedAt: expect.any(String),
      });

      const all = await t.api('POST', '/api/proxies/check-all');
      expect(all.json).toMatchObject({ total: 3, ok: 2, failed: 1 });
      expect(all.json.results.map((result: Record<string, unknown>) => [result.proxyId, result.status, result.exitIp])).toEqual([
        [httpRow.id, 'ok', '203.0.113.7'],
        [socksRow.id, 'ok', '203.0.113.7'],
        [deadRow.id, 'failed', null],
      ]);
      expect(all.json.results[2].error).toBeTruthy();
      for (const secret of ['proxy-secret', 'socks-secret', 'dead-secret']) expect(all.body).not.toContain(secret);

      const listed = (await t.api('GET', '/api/proxies')).json;
      expect(listed.map((row: Record<string, unknown>) => row.status)).toEqual(['ok', 'ok', 'failed']);
      expect(listed.map((row: Record<string, unknown>) => row.lastExitIp)).toEqual(['203.0.113.7', '203.0.113.7', null]);
      expect(listed[2]).toMatchObject({ lastError: expect.any(String), lastCheckedAt: expect.any(String) });
      expect(listed[0].lastLatencyMs).toEqual(expect.any(Number));
      expect((await t.api('POST', `/api/proxies/${UNKNOWN_ID}/check`)).statusCode).toBe(404);

      // A different URL is a different proxy: the stored exit IP no longer applies.
      const moved = await t.api('PATCH', `/api/proxies/${httpRow.id}`, { url: `http://127.0.0.1:${await closedPort()}` });
      expect(moved.json).toMatchObject({ status: 'unknown', lastExitIp: null });
    } finally {
      await http.close();
      await socks.close();
    }
  });
});

describe('GET /api/stats/overview', () => {
  it('summarizes providers, keys, proxies, sessions and the last 24h of requests', async () => {
    const provider = await createProvider();
    await createProvider({ name: 'Disabled', enabled: false });
    const { db } = t.database;
    const now = Date.now();
    const keyIds = [];
    for (const key of ['stats-key-0001', 'stats-key-0002', 'stats-key-0003', 'stats-key-0004']) {
      keyIds.push((await addKey(provider.id, key)).id);
    }
    db.update(apiKeys).set({ status: 'cooldown', cooldownUntil: new Date(now + 60_000) }).where(eq(apiKeys.id, keyIds[1] ?? '')).run();
    db.update(apiKeys).set({ status: 'cooldown', cooldownUntil: new Date(now - 60_000) }).where(eq(apiKeys.id, keyIds[2] ?? '')).run();
    db.update(apiKeys).set({ status: 'disabled', enabled: false }).where(eq(apiKeys.id, keyIds[3] ?? '')).run();

    for (const url of ['10.0.0.1:8080', '10.0.0.2:8080', '10.0.0.3:8080']) await t.api('POST', '/api/proxies', { url });
    const [first, second] = db.select().from(proxies).all();
    db.update(proxies).set({ status: 'ok' }).where(eq(proxies.id, first?.id ?? '')).run();
    db.update(proxies).set({ status: 'failed', enabled: false }).where(eq(proxies.id, second?.id ?? '')).run();

    const endpoint = (await t.api('POST', '/api/endpoints', { name: 'Stats' })).json;
    db.insert(sessions)
      .values([
        { id: 'live', endpointId: endpoint.id, expiresAt: new Date(now + 60_000) },
        { id: 'expired', endpointId: endpoint.id, expiresAt: new Date(now - 60_000) },
      ])
      .run();
    db.insert(requestLogs)
      .values([
        { method: 'tools/call', status: 'ok', createdAt: new Date(now - 1_000) },
        { method: 'tools/call', status: 'ok', createdAt: new Date(now - 3_600_000) },
        { method: 'tools/call', status: 'error', createdAt: new Date(now - 7_200_000) },
        { method: 'tools/call', status: 'error', createdAt: new Date(now - 2 * 86_400_000) },
      ])
      .run();

    expect((await t.api('GET', '/api/stats/overview')).json).toEqual({
      providers: { total: 2, enabled: 1 },
      keys: { total: 4, enabled: 3, active: 2, cooldown: 1, disabled: 1 },
      proxies: { total: 3, enabled: 2, ok: 1, failed: 1, unknown: 1 },
      sessions: { active: 1 },
      requests24h: { total: 3, ok: 2, error: 1, errorRate: 0.3333 },
    });
    expect(db.select().from(endpoints).all()).toHaveLength(1);
  });
});

describe('GET /api/stats/timeseries', () => {
  it('returns hour-aligned request and error counts, oldest first, with empty hours as zeros', async () => {
    const HOUR = 3_600_000;
    const currentHour = Math.floor(Date.now() / HOUR) * HOUR;
    const at = (hoursAgo: number, offsetMs = 1) => new Date(currentHour - hoursAgo * HOUR + offsetMs);
    t.database.db
      .insert(requestLogs)
      .values([
        { method: 'tools/call', status: 'ok' as const, createdAt: at(0) },
        { method: 'tools/call', status: 'error' as const, createdAt: at(0, 2) },
        { method: 'tools/call', status: 'ok' as const, createdAt: at(2) },
        { method: 'tools/call', status: 'ok' as const, createdAt: at(2, HOUR - 1) },
        { method: 'tools/call', status: 'error' as const, createdAt: at(23) },
        // Before the first bucket of a 24-hour window.
        { method: 'tools/call', status: 'error' as const, createdAt: at(24) },
      ])
      .run();

    const res = await t.api('GET', '/api/stats/timeseries');
    expect(res.statusCode).toBe(200);
    expect(res.json.bucketMinutes).toBe(60);
    const buckets = res.json.buckets as { start: string; total: number; ok: number; error: number }[];
    expect(buckets).toHaveLength(24);
    expect(buckets[0]).toEqual({ start: at(23, 0).toISOString(), total: 1, ok: 0, error: 1 });
    expect(buckets[21]).toEqual({ start: at(2, 0).toISOString(), total: 2, ok: 2, error: 0 });
    expect(buckets[23]).toEqual({ start: new Date(currentHour).toISOString(), total: 2, ok: 1, error: 1 });
    expect(buckets.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(5);

    const short = (await t.api('GET', '/api/stats/timeseries?hours=3')).json;
    expect(short.buckets.map((bucket: { total: number }) => bucket.total)).toEqual([2, 0, 2]);
    expect((await t.api('GET', '/api/stats/timeseries?hours=0')).statusCode).toBe(400);
    expect((await t.api('GET', '/api/stats/timeseries?hours=169')).statusCode).toBe(400);
  });
});

describe('request log retention', () => {
  it('deletes logs older than LOG_RETENTION_DAYS', async () => {
    const retention = await createTestContext({ LOG_RETENTION_DAYS: '7' });
    try {
      const now = Date.now();
      retention.database.db
        .insert(requestLogs)
        .values([8, 6, 0].map((days) => ({ method: 'tools/call', status: 'ok' as const, createdAt: new Date(now - days * 86_400_000) })))
        .run();
      expect(retention.gateway.deleteOldLogs(now)).toBe(1);
      expect(retention.database.db.select().from(requestLogs).all()).toHaveLength(2);
    } finally {
      await retention.close();
    }
  });
});

describe('stdio providers', () => {
  it('spawns the command with {{API_KEY}} substituted in env and args, plus proxy variables', async () => {
    const proxy = await startHttpProxy();
    try {
      const script = fileURLToPath(new URL('./support/stdio-server.mjs', import.meta.url));
      const provider = await createProvider({
        name: 'Local',
        transport: 'stdio',
        url: null,
        command: process.execPath,
        args: [script, '--key={{API_KEY}}'],
        env: { MOCK_API_KEY: '{{API_KEY}}' },
      });
      await addKey(provider.id, 'stdio-key-0001');
      const proxyRow = (await t.api('POST', '/api/proxies', { url: proxy.url })).json;
      await addKey(provider.id, 'stdio-key-0002', { proxyId: proxyRow.id });

      const endpoint = (await t.api('POST', '/api/endpoints', { name: 'Stdio' })).json;
      await t.api('PUT', `/api/endpoints/${endpoint.id}/providers`, { providers: [{ providerId: provider.id }] });
      const baseUrl = await t.listen();
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const outputs: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const client = new Client({ name: 'stdio-test', version: '1.0.0' });
        await client.connect(
          new StreamableHTTPClientTransport(new URL(`/mcp/${endpoint.slug}`, baseUrl), {
            requestInit: { headers: { Authorization: `Bearer ${endpoint.accessToken}` } },
          }),
        );
        const result = await client.callTool({ name: 'report' });
        outputs.push((result.content as { text: string }[])[0]?.text ?? '');
        await client.close();
      }
      expect(outputs).toEqual([
        'env=STDIO-KEY-0001 arg=--KEY=STDIO-KEY-0001 proxy=unset',
        'env=STDIO-KEY-0002 arg=--KEY=STDIO-KEY-0002 proxy=set',
      ]);
      // Routing the call without prefixes needed the tool list, which is now cached.
      const cached = t.database.db.select().from(providers).where(eq(providers.id, provider.id)).get()?.cachedTools;
      expect(cached?.map((tool) => tool.name)).toEqual(['report']);
    } finally {
      await proxy.close();
    }
  });
});
