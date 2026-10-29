import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiKeys, endpoints, proxies, requestLogs, sessionBindings, sessions } from '../src/db/schema';
import { SecretBox, sha256Hex } from '../src/lib/crypto';
import { ADMIN, createTestContext, exaProvider, type TestContext } from './helpers';

const UNKNOWN_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

let t: TestContext;
beforeEach(async () => {
  t = await createTestContext();
});
afterEach(async () => {
  await t.close();
});

async function createProvider(overrides: Record<string, unknown> = {}) {
  const res = await t.api('POST', '/api/providers', { ...exaProvider, ...overrides });
  expect(res.statusCode, res.body).toBe(201);
  return res.json;
}

describe('admin auth', () => {
  it('protects every /api route except login', async () => {
    const routes = [
      ['GET', '/api/providers'],
      ['POST', '/api/providers'],
      ['GET', '/api/logs'],
      ['GET', '/api/sessions'],
      ['POST', '/api/proxies/bulk'],
      ['GET', '/api/auth/me'],
      ['POST', '/api/auth/logout'],
      ['GET', '/api/not-a-route'],
    ] as const;
    for (const [method, url] of routes) {
      expect((await t.app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await t.app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ status: 'ok' });
  });

  it('issues a signed httpOnly session cookie and clears it on logout', async () => {
    const bad = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { ...ADMIN, password: 'wrong-pass' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.cookies).toHaveLength(0);
    expect((await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode).toBe(400);

    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ username: ADMIN.username, expiresAt: expect.any(String) });
    const cookie = login.cookies.find((c) => c.name === 'mcproute_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 86_400 });
    const value = cookie?.value ?? '';

    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', cookies: { mcproute_session: value } });
    expect(me.json()).toMatchObject({ username: ADMIN.username });

    const tampered = `${value[0] === 'a' ? 'b' : 'a'}${value.slice(1)}`;
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp: 9_999_999_999 })).toString('base64url');
    for (const candidate of [tampered, forged]) {
      const res = await t.app.inject({ method: 'GET', url: '/api/auth/me', cookies: { mcproute_session: candidate } });
      expect(res.statusCode).toBe(401);
    }

    const logout = await t.app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { mcproute_session: value } });
    expect(logout.statusCode).toBe(204);
    expect(logout.cookies.find((c) => c.name === 'mcproute_session')?.value).toBe('');
  });

  it('rejects sessions signed for different admin credentials', async () => {
    const other = await createTestContext({ ADMIN_PASSWORD: 'another-admin-password' });
    try {
      const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
      const value = login.cookies.find((c) => c.name === 'mcproute_session')?.value ?? '';
      const res = await other.app.inject({ method: 'GET', url: '/api/auth/me', cookies: { mcproute_session: value } });
      expect(res.statusCode).toBe(401);
    } finally {
      await other.close();
    }
  });
});

describe('providers', () => {
  it('creates a provider with derived slug, auth mode and defaults', async () => {
    const provider = await createProvider();
    expect(provider).toMatchObject({
      name: 'Exa Search',
      slug: 'exa-search',
      transport: 'streamable_http',
      url: 'https://mcp.exa.ai/mcp?exaApiKey={{API_KEY}}',
      authMode: 'url_placeholder',
      authHeaderName: 'Authorization',
      authValueTemplate: 'Bearer {{API_KEY}}',
      authQueryParam: null,
      rotationStrategy: 'round_robin',
      failoverEnabled: true,
      cooldownSeconds: 300,
      failureRules: { httpStatuses: [401, 402, 403, 429], messagePatterns: ['rate limit|quota|credit|insufficient'] },
      cachedTools: null,
      toolsFetchedAt: null,
      enabled: true,
      keyStats: { total: 0, enabled: 0, active: 0, cooldown: 0, disabled: 0 },
    });
    expect((await t.api('GET', `/api/providers/${provider.id}`)).json).toEqual(provider);
    expect((await t.api('GET', '/api/providers')).json).toEqual([provider]);
  });

  it('supports stdio providers that receive the key through env', async () => {
    const provider = await createProvider({
      name: 'Exa (local)',
      transport: 'stdio',
      url: null,
      command: 'npx',
      args: ['-y', 'exa-mcp-server'],
      env: { EXA_API_KEY: '{{API_KEY}}' },
    });
    expect(provider).toMatchObject({ slug: 'exa-local', authMode: 'env', command: 'npx', args: ['-y', 'exa-mcp-server'] });
  });

  it('validates transport / auth combinations', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ transport: 'stdio', url: null }, 'command'],
      [{ transport: 'stdio', command: 'npx', env: { EXA_API_KEY: 'static' } }, 'env'],
      [{ url: null }, 'url'],
      [{ url: 'ftp://example.com/{{API_KEY}}' }, 'url'],
      [{ url: 'https://example.com/mcp', authMode: 'header', authValueTemplate: 'Bearer static' }, 'authValueTemplate'],
      [{ url: 'https://example.com/mcp', authMode: 'query' }, 'authQueryParam'],
      [{ url: 'https://example.com/mcp', authMode: 'url_placeholder' }, 'url'],
      [{ authMode: 'env' }, 'authMode'],
      [{ slug: 'Not A Slug' }, 'slug'],
      [{ cooldownSeconds: -1 }, 'cooldownSeconds'],
      [{ failureRules: { httpStatuses: [429], messagePatterns: ['(unclosed'] } }, 'failureRules.messagePatterns.0'],
    ];
    for (const [overrides, path] of cases) {
      const res = await t.api('POST', '/api/providers', { ...exaProvider, ...overrides });
      expect(res.statusCode, JSON.stringify(overrides)).toBe(400);
      expect(res.json.issues.map((issue: { path: string }) => issue.path), JSON.stringify(overrides)).toContain(path);
    }
  });

  it('rejects duplicate slugs and re-validates merged updates', async () => {
    const provider = await createProvider();
    expect((await t.api('POST', '/api/providers', exaProvider)).statusCode).toBe(409);

    const updated = await t.api('PATCH', `/api/providers/${provider.id}`, {
      cooldownSeconds: 60,
      rotationStrategy: 'least_used',
      description: '  Neural web search  ',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json).toMatchObject({
      cooldownSeconds: 60,
      rotationStrategy: 'least_used',
      description: 'Neural web search',
      url: exaProvider.url,
      authMode: 'url_placeholder',
    });

    // Switching to stdio alone leaves an invalid provider (no command, wrong auth mode).
    expect((await t.api('PATCH', `/api/providers/${provider.id}`, { transport: 'stdio' })).statusCode).toBe(400);

    const other = await createProvider({ name: 'Other' });
    expect((await t.api('PATCH', `/api/providers/${other.id}`, { slug: 'exa-search' })).statusCode).toBe(409);
  });

  it('deletes providers together with their keys', async () => {
    const provider = await createProvider();
    await t.api('POST', `/api/providers/${provider.id}/keys`, { key: 'exa-key-000000000001' });
    expect((await t.api('GET', `/api/providers/${provider.id}`)).json.keyStats).toMatchObject({ total: 1, active: 1 });
    expect((await t.api('DELETE', `/api/providers/${provider.id}`)).statusCode).toBe(204);
    expect((await t.api('GET', `/api/providers/${provider.id}`)).statusCode).toBe(404);
    expect(t.database.db.select().from(apiKeys).all()).toHaveLength(0);
  });

  it('returns 400 for malformed ids and 404 for unknown ones', async () => {
    expect((await t.api('GET', '/api/providers/not-a-uuid')).statusCode).toBe(400);
    expect((await t.api('GET', `/api/providers/${UNKNOWN_ID}`)).statusCode).toBe(404);
    expect((await t.api('DELETE', `/api/keys/${UNKNOWN_ID}`)).statusCode).toBe(404);
  });
});

describe('api keys', () => {
  it('stores keys encrypted and only returns masked keys', async () => {
    const provider = await createProvider();
    const created = await t.api('POST', `/api/providers/${provider.id}/keys`, { key: 'sk-live-0123456789abcd', label: 'Main' });
    expect(created.statusCode).toBe(201);
    expect(created.json).toMatchObject({
      providerId: provider.id,
      label: 'Main',
      maskedKey: 'sk-****abcd',
      proxyId: null,
      proxy: null,
      enabled: true,
      weight: 1,
      status: 'active',
      cooldownUntil: null,
      usageCount: 0,
      errorCount: 0,
      activeSessions: 0,
    });

    const list = await t.api('GET', `/api/providers/${provider.id}/keys`);
    const single = await t.api('GET', `/api/keys/${created.json.id}`);
    for (const body of [created.body, list.body, single.body]) expect(body).not.toContain('0123456789');

    const row = t.database.db.select().from(apiKeys).get();
    expect(row?.key).not.toContain('0123456789');
    expect(new SecretBox(t.config.masterKey).decrypt(row?.key ?? '')).toBe('sk-live-0123456789abcd');

    expect((await t.api('POST', `/api/providers/${provider.id}/keys`, { key: 'sk-live-0123456789abcd' })).statusCode).toBe(409);
    const backup = await createProvider({ name: 'Exa Backup' });
    expect((await t.api('POST', `/api/providers/${backup.id}/keys`, { key: 'sk-live-0123456789abcd' })).statusCode).toBe(201);
  });

  it('updates, cools down, resets and deletes keys', async () => {
    const provider = await createProvider({ cooldownSeconds: 120 });
    const key = (await t.api('POST', `/api/providers/${provider.id}/keys`, { key: 'sk-first-key-00001111' })).json;
    expect(key.label).toBe('sk-****1111');

    const rotated = await t.api('PATCH', `/api/keys/${key.id}`, { key: 'sk-second-key-0002222', weight: 5, enabled: false });
    expect(rotated.json).toMatchObject({ maskedKey: 'sk-****2222', label: 'sk-****2222', weight: 5, enabled: false });

    const cooled = await t.api('PATCH', `/api/keys/${key.id}`, { status: 'cooldown' });
    expect(cooled.json.status).toBe('cooldown');
    expect(Date.parse(cooled.json.cooldownUntil) - Date.now()).toBeGreaterThan(110_000);
    expect((await t.api('PATCH', `/api/keys/${key.id}`, { status: 'active' })).json).toMatchObject({
      status: 'active',
      cooldownUntil: null,
    });

    expect((await t.api('PATCH', `/api/keys/${key.id}`, { proxyId: UNKNOWN_ID })).statusCode).toBe(400);
    expect((await t.api('PATCH', `/api/keys/${key.id}`, { key: 'has space' })).statusCode).toBe(400);
    expect((await t.api('DELETE', `/api/keys/${key.id}`)).statusCode).toBe(204);
    expect((await t.api('GET', `/api/keys/${key.id}`)).statusCode).toBe(404);
  });

  it('bulk imports keys with inline proxies, skipping duplicates and reporting bad lines', async () => {
    const provider = await createProvider();
    await t.api('POST', `/api/providers/${provider.id}/keys`, { key: 'exa-existing-key-0000' });
    const existingProxy = (await t.api('POST', '/api/proxies', { url: 'socks5://user:pw@10.0.0.1:1080' })).json;

    const text = [
      '# Exa keys',
      'exa-key-aaaa-0001',
      'exa-key-bbbb-0002|10.0.0.1:1080:user:pw',
      'exa-key-cccc-0003|socks5://s:secret@10.0.0.2:1080|Team C',
      'exa-key-dddd-0004|10.0.0.3:3128',
      'exa-key-eeee-0005|10.0.0.3:3128|Shares a proxy',
      'exa-existing-key-0000',
      'exa-key-aaaa-0001',
      'exa-key-ffff-0006|ftp://bad:proxy@1.1.1.1:21',
      'bad key with spaces',
    ].join('\n');
    const res = await t.api('POST', `/api/providers/${provider.id}/keys/bulk`, { text, defaultProxyScheme: 'socks5' });
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({
      created: 5,
      skipped: 2,
      proxiesCreated: 2,
      errors: [
        { line: 9, message: expect.stringMatching(/^Invalid proxy/) },
        { line: 10, message: expect.stringMatching(/printable ASCII/) },
      ],
    });

    const keys = (await t.api('GET', `/api/providers/${provider.id}/keys`)).json;
    expect(keys.map((k: { label: string; proxy: { url: string } | null }) => [k.label, k.proxy?.url ?? null])).toEqual([
      ['exa****0000', null],
      ['exa****0001', null],
      ['exa****0002', 'socks5://user:****@10.0.0.1:1080'],
      ['Team C', 'socks5://s:****@10.0.0.2:1080'],
      ['exa****0004', 'socks5://10.0.0.3:3128'],
      ['Shares a proxy', 'socks5://10.0.0.3:3128'],
    ]);
    expect(keys[2].proxyId).toBe(existingProxy.id);
    expect(keys[4].proxyId).toBe(keys[5].proxyId);
    expect(t.database.db.select().from(proxies).all()).toHaveLength(3);

    const exposed = res.body + JSON.stringify(keys);
    for (const secret of ['exa-key-aaaa', 'exa-key-cccc', 'secret@', ':pw@', 'bad:proxy']) expect(exposed).not.toContain(secret);
  });

  it('caps the number of lines per import', async () => {
    const provider = await createProvider();
    const text = Array.from({ length: 10_001 }, (_, i) => `key-${i}`).join('\n');
    const res = await t.api('POST', `/api/providers/${provider.id}/keys/bulk`, { text });
    expect(res.statusCode).toBe(400);
    expect(res.json.issues[0].message).toMatch(/max 10000/);
  });
});

describe('assign-proxies', () => {
  async function setup(keyCount: number, proxyCount: number) {
    const provider = await createProvider();
    const keyText = Array.from({ length: keyCount }, (_, i) => `assign-key-${String(i).padStart(4, '0')}`).join('\n');
    await t.api('POST', `/api/providers/${provider.id}/keys/bulk`, { text: keyText });
    const proxyText = Array.from({ length: proxyCount }, (_, i) => `10.1.0.${i + 1}:8080`).join('\n');
    await t.api('POST', '/api/proxies/bulk', { text: proxyText });
    const proxyIds: string[] = (await t.api('GET', '/api/proxies')).json.map((p: { id: string }) => p.id);
    const keyProxyIds = async (): Promise<(string | null)[]> =>
      (await t.api('GET', `/api/providers/${provider.id}/keys`)).json.map((k: { proxyId: string | null }) => k.proxyId);
    const assign = (body: Record<string, unknown>) => t.api('POST', `/api/providers/${provider.id}/keys/assign-proxies`, body);
    return { proxyIds, keyProxyIds, assign };
  }

  it('round_robin cycles through the pool in order', async () => {
    const { proxyIds, keyProxyIds, assign } = await setup(7, 3);
    expect((await assign({ mode: 'round_robin', onlyUnassigned: false })).json).toEqual({ assigned: 7, unassigned: 0 });
    expect((await keyProxyIds()).map((id) => proxyIds.indexOf(id ?? ''))).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it('round_robin with onlyUnassigned balances around existing assignments', async () => {
    const { proxyIds, keyProxyIds, assign } = await setup(6, 3);
    const keys = (await t.api('GET', '/api/providers')).json[0];
    const keyList = (await t.api('GET', `/api/providers/${keys.id}/keys`)).json;
    for (const key of keyList.slice(0, 2)) await t.api('PATCH', `/api/keys/${key.id}`, { proxyId: proxyIds[0] });

    expect((await assign({ mode: 'round_robin', onlyUnassigned: true })).json).toEqual({ assigned: 4, unassigned: 0 });
    const assigned = await keyProxyIds();
    expect(proxyIds.map((id) => assigned.filter((p) => p === id).length)).toEqual([2, 2, 2]);
  });

  it('one_to_one never shares a proxy and reports keys left without one', async () => {
    const { proxyIds, keyProxyIds, assign } = await setup(5, 3);
    expect((await assign({ mode: 'one_to_one', onlyUnassigned: false })).json).toEqual({ assigned: 3, unassigned: 2 });
    expect(await keyProxyIds()).toEqual([proxyIds[0], proxyIds[1], proxyIds[2], null, null]);

    await t.api('POST', '/api/proxies', { url: '10.2.0.1:8080' });
    expect((await assign({ mode: 'one_to_one', onlyUnassigned: true })).json).toEqual({ assigned: 1, unassigned: 1 });
    const assigned = (await keyProxyIds()).filter(Boolean);
    expect(assigned).toHaveLength(4);
    expect(new Set(assigned).size).toBe(4);
  });

  it('random uses only the selected, enabled proxies', async () => {
    const { proxyIds, keyProxyIds, assign } = await setup(20, 4);
    await t.api('PATCH', `/api/proxies/${proxyIds[1]}`, { enabled: false });
    const selected = [proxyIds[0], proxyIds[1], proxyIds[2]];
    expect((await assign({ mode: 'random', onlyUnassigned: false, proxyIds: selected })).json).toEqual({
      assigned: 20,
      unassigned: 0,
    });
    for (const id of await keyProxyIds()) expect([proxyIds[0], proxyIds[2]]).toContain(id);
  });

  it('rejects an empty pool, unknown proxy ids and incomplete requests', async () => {
    const { assign } = await setup(2, 0);
    expect((await assign({ mode: 'round_robin', onlyUnassigned: false })).json.message).toMatch(/No enabled proxies/);
    expect((await assign({ mode: 'round_robin', onlyUnassigned: false, proxyIds: [UNKNOWN_ID] })).json.message).toMatch(
      /Unknown proxy IDs/,
    );
    expect((await assign({ mode: 'round_robin' })).statusCode).toBe(400);
    expect((await assign({ mode: 'sequential', onlyUnassigned: false })).statusCode).toBe(400);
  });
});

describe('proxies', () => {
  it('creates proxies with masked passwords and rejects duplicates', async () => {
    const res = await t.api('POST', '/api/proxies', { url: 'SOCKS5://Alice:S3cret@Proxy.Example.com:1080', label: 'EU 1' });
    expect(res.statusCode).toBe(201);
    expect(res.json).toMatchObject({
      label: 'EU 1',
      url: 'socks5://Alice:****@proxy.example.com:1080',
      scheme: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      username: 'Alice',
      hasPassword: true,
      enabled: true,
      status: 'unknown',
      keyCount: 0,
    });
    expect(res.body).not.toContain('S3cret');
    const duplicate = await t.api('POST', '/api/proxies', { url: 'socks5://Alice:S3cret@proxy.example.com:1080' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body).not.toContain('S3cret');
    expect((await t.api('POST', '/api/proxies', { url: 'not a proxy' })).statusCode).toBe(400);
  });

  it('bulk imports every format with the selected default scheme', async () => {
    await t.api('POST', '/api/proxies', { url: 'socks5://1.1.1.1:1080' });
    const text = [
      'socks5://1.1.1.1:1080',
      '1.1.1.1:1080',
      '2.2.2.2:1080:user:pass',
      'http://u:p@3.3.3.3:8080',
      'u2:p2@4.4.4.4:1080',
      '2.2.2.2:1080:user:pass',
      'garbage',
      '',
    ].join('\n');
    const res = await t.api('POST', '/api/proxies/bulk', { text, defaultScheme: 'socks5' });
    expect(res.json).toEqual({ created: 3, skipped: 3, errors: [{ line: 7, message: expect.any(String) }] });
    expect((await t.api('GET', '/api/proxies')).json.map((p: { url: string }) => p.url)).toEqual([
      'socks5://1.1.1.1:1080',
      'socks5://user:****@2.2.2.2:1080',
      'http://u:****@3.3.3.3:8080',
      'socks5://u2:****@4.4.4.4:1080',
    ]);
    expect((await t.api('POST', '/api/proxies/bulk', { text: '1.2.3.4:80', defaultScheme: 'https' })).statusCode).toBe(400);
  });

  it('updates proxies, resets health on URL change and detaches keys on delete', async () => {
    const proxy = (await t.api('POST', '/api/proxies', { url: '5.5.5.5:8080' })).json;
    t.database.db
      .update(proxies)
      .set({ status: 'ok', lastLatencyMs: 42, lastCheckedAt: new Date() })
      .where(eq(proxies.id, proxy.id))
      .run();

    const relabeled = await t.api('PATCH', `/api/proxies/${proxy.id}`, { label: 'Fast', enabled: false });
    expect(relabeled.json).toMatchObject({ label: 'Fast', enabled: false, status: 'ok', lastLatencyMs: 42 });
    const moved = await t.api('PATCH', `/api/proxies/${proxy.id}`, { url: '6.6.6.6:8080' });
    expect(moved.json).toMatchObject({ url: 'http://6.6.6.6:8080', status: 'unknown', lastLatencyMs: null, lastCheckedAt: null });

    const provider = await createProvider();
    const key = (await t.api('POST', `/api/providers/${provider.id}/keys`, { key: 'proxied-key-000001', proxyId: proxy.id })).json;
    expect(key.proxy).toMatchObject({ id: proxy.id, url: 'http://6.6.6.6:8080', label: 'Fast' });
    expect((await t.api('GET', `/api/proxies/${proxy.id}`)).json.keyCount).toBe(1);

    expect((await t.api('DELETE', `/api/proxies/${proxy.id}`)).statusCode).toBe(204);
    expect((await t.api('GET', `/api/keys/${key.id}`)).json).toMatchObject({ proxyId: null, proxy: null });
  });
});

describe('endpoints', () => {
  it('returns the access token once and stores only its SHA-256 hash', async () => {
    const res = await t.api('POST', '/api/endpoints', { name: 'Research Tools' });
    expect(res.statusCode).toBe(201);
    const { accessToken, ...endpoint } = res.json;
    expect(accessToken).toMatch(/^mcpr_[\w-]{43}$/);
    expect(endpoint).toMatchObject({
      name: 'Research Tools',
      slug: 'research-tools',
      mcpPath: '/mcp/research-tools',
      accessTokenHint: `mcpr_****${accessToken.slice(-4)}`,
      toolPrefixMode: 'none',
      enableSse: false,
      enabled: true,
      providers: [],
    });

    const fetched = await t.api('GET', `/api/endpoints/${endpoint.id}`);
    expect(fetched.json).toEqual(endpoint);
    expect(fetched.body + (await t.api('GET', '/api/endpoints')).body).not.toContain(accessToken);
    expect(t.database.db.select().from(endpoints).get()?.accessTokenHash).toBe(sha256Hex(accessToken));

    const regenerated = await t.api('POST', `/api/endpoints/${endpoint.id}/regenerate-token`);
    expect(regenerated.statusCode).toBe(200);
    expect(regenerated.json.accessToken).toMatch(/^mcpr_/);
    expect(regenerated.json.accessToken).not.toBe(accessToken);
    expect(t.database.db.select().from(endpoints).get()?.accessTokenHash).toBe(sha256Hex(regenerated.json.accessToken));
  });

  it('updates endpoints and links providers with tool filters', async () => {
    const exa = await createProvider();
    const brave = await createProvider({ name: 'Brave Search', url: 'https://example.com/mcp', authMode: 'header' });
    const endpoint = (await t.api('POST', '/api/endpoints', { name: 'All Search', toolPrefixMode: 'provider_slug' })).json;
    const setProviders = (providers: unknown[]) => t.api('PUT', `/api/endpoints/${endpoint.id}/providers`, { providers });

    const linked = await setProviders([
      { providerId: exa.id, toolFilterMode: 'allowlist', toolNames: ['web_search_exa', 'web_search_exa'] },
      { providerId: brave.id },
    ]);
    expect(linked.statusCode).toBe(200);
    expect(linked.json.providers).toEqual([
      { providerId: brave.id, providerName: 'Brave Search', providerSlug: 'brave-search', toolFilterMode: 'all', toolNames: [] },
      {
        providerId: exa.id,
        providerName: 'Exa Search',
        providerSlug: 'exa-search',
        toolFilterMode: 'allowlist',
        toolNames: ['web_search_exa'],
      },
    ]);

    expect((await setProviders([{ providerId: exa.id }, { providerId: exa.id }])).statusCode).toBe(400);
    expect((await setProviders([{ providerId: UNKNOWN_ID }])).json.message).toMatch(/Unknown provider IDs/);
    const replaced = await setProviders([{ providerId: exa.id, toolFilterMode: 'denylist', toolNames: ['crawling_exa'] }]);
    expect(replaced.json.providers).toHaveLength(1);
    expect((await t.api('GET', '/api/endpoints')).json[0].providers[0]).toMatchObject({
      toolFilterMode: 'denylist',
      toolNames: ['crawling_exa'],
    });

    const patched = await t.api('PATCH', `/api/endpoints/${endpoint.id}`, { slug: 'search', enableSse: true });
    expect(patched.json).toMatchObject({ slug: 'search', mcpPath: '/mcp/search', enableSse: true, toolPrefixMode: 'provider_slug' });
    await t.api('POST', '/api/endpoints', { name: 'Second' });
    expect((await t.api('PATCH', `/api/endpoints/${endpoint.id}`, { slug: 'second' })).statusCode).toBe(409);

    await t.api('DELETE', `/api/providers/${exa.id}`);
    expect((await t.api('GET', `/api/endpoints/${endpoint.id}`)).json.providers).toEqual([]);
    expect((await t.api('DELETE', `/api/endpoints/${endpoint.id}`)).statusCode).toBe(204);
    expect((await t.api('GET', `/api/endpoints/${endpoint.id}`)).statusCode).toBe(404);
  });
});

describe('logs', () => {
  it('paginates and filters by endpoint, provider, key, status and date range', async () => {
    const provider = await createProvider();
    const key = (await t.api('POST', `/api/providers/${provider.id}/keys`, { key: 'log-key-00000001' })).json;
    const endpoint = (await t.api('POST', '/api/endpoints', { name: 'Logs' })).json;
    const base = Date.parse('2026-01-10T12:00:00.000Z');
    t.database.db
      .insert(requestLogs)
      .values(
        Array.from({ length: 30 }, (_, i) => ({
          endpointId: endpoint.id,
          sessionId: 'session-1',
          providerId: i % 3 === 0 ? provider.id : null,
          apiKeyId: i % 3 === 0 ? key.id : null,
          toolName: 'web_search_exa',
          method: 'tools/call',
          status: i % 5 === 0 ? ('error' as const) : ('ok' as const),
          latencyMs: 100 + i,
          errorMessage: i % 5 === 0 ? 'Upstream returned 429' : null,
          createdAt: new Date(base + i * 3_600_000),
        })),
      )
      .run();

    const page1 = (await t.api('GET', '/api/logs?pageSize=10')).json;
    expect(page1).toMatchObject({ total: 30, page: 1, pageSize: 10 });
    expect(page1.items).toHaveLength(10);
    expect(page1.items[0]).toMatchObject({ latencyMs: 129, endpointName: 'Logs', method: 'tools/call', status: 'ok' });
    expect((await t.api('GET', '/api/logs?pageSize=10&page=3')).json.items.at(-1).latencyMs).toBe(100);

    expect((await t.api('GET', '/api/logs?status=error')).json.total).toBe(6);
    expect((await t.api('GET', `/api/logs?providerId=${provider.id}`)).json.total).toBe(10);
    expect((await t.api('GET', `/api/logs?endpointId=${endpoint.id}`)).json.total).toBe(30);
    const byKey = (await t.api('GET', `/api/logs?apiKeyId=${key.id}&status=error`)).json;
    expect(byKey.total).toBe(2);
    expect(byKey.items[0]).toMatchObject({ providerName: 'Exa Search', apiKeyLabel: 'log****0001', errorMessage: 'Upstream returned 429' });

    expect((await t.api('GET', '/api/logs?from=2026-01-10&to=2026-01-10')).json.total).toBe(12);
    expect((await t.api('GET', '/api/logs?from=2026-01-11T00:00:00Z&to=2026-01-11T05:00:00Z')).json.total).toBe(6);
    expect((await t.api('GET', '/api/logs?from=2026-01-12&to=2026-01-11')).statusCode).toBe(400);
    expect((await t.api('GET', '/api/logs?status=maybe')).statusCode).toBe(400);
    expect((await t.api('GET', '/api/logs?pageSize=1000')).statusCode).toBe(400);
  });
});

describe('sessions', () => {
  it('lists active sessions with their bound keys and deletes sessions', async () => {
    const provider = await createProvider();
    const key = (await t.api('POST', `/api/providers/${provider.id}/keys`, { key: 'session-key-0000001' })).json;
    const endpoint = (await t.api('POST', '/api/endpoints', { name: 'Sessions' })).json;
    const now = Date.now();
    const { db } = t.database;
    db.insert(sessions)
      .values([
        { id: 'active-1', endpointId: endpoint.id, lastSeenAt: new Date(now - 1_000), expiresAt: new Date(now + 3_600_000) },
        { id: 'active-2', endpointId: endpoint.id, lastSeenAt: new Date(now - 5_000), expiresAt: new Date(now + 3_600_000) },
        { id: 'expired-1', endpointId: endpoint.id, lastSeenAt: new Date(now - 7_200_000), expiresAt: new Date(now - 1_000) },
      ])
      .run();
    db.insert(sessionBindings)
      .values(['active-1', 'active-2', 'expired-1'].map((sessionId) => ({ sessionId, providerId: provider.id, apiKeyId: key.id })))
      .run();
    db.update(apiKeys).set({ activeSessions: 3 }).where(eq(apiKeys.id, key.id)).run();

    const list = await t.api('GET', '/api/sessions');
    expect(list.json).toMatchObject({ total: 2, page: 1 });
    expect(list.json.items.map((s: { id: string }) => s.id)).toEqual(['active-1', 'active-2']);
    expect(list.json.items[0]).toMatchObject({
      endpointId: endpoint.id,
      endpointName: 'Sessions',
      endpointSlug: 'sessions',
      bindings: [
        {
          providerId: provider.id,
          providerName: 'Exa Search',
          providerSlug: 'exa-search',
          apiKeyId: key.id,
          apiKeyLabel: 'ses****0001',
          maskedKey: 'ses****0001',
          proxyId: null,
        },
      ],
    });
    expect(list.body).not.toContain('session-key-0000001');
    expect((await t.api('GET', `/api/sessions?endpointId=${endpoint.id}&pageSize=1`)).json.items).toHaveLength(1);

    expect((await t.api('DELETE', '/api/sessions/active-1')).statusCode).toBe(204);
    expect((await t.api('GET', '/api/sessions')).json.total).toBe(1);
    expect((await t.api('GET', `/api/keys/${key.id}`)).json.activeSessions).toBe(2);
    expect(db.select().from(sessionBindings).where(eq(sessionBindings.sessionId, 'active-1')).all()).toHaveLength(0);
    expect((await t.api('DELETE', '/api/sessions/active-1')).statusCode).toBe(404);
  });
});

describe('logging', () => {
  it('never writes plaintext keys, proxy passwords, tokens or admin credentials', async () => {
    const provider = await createProvider();
    await t.api('POST', `/api/providers/${provider.id}/keys`, { key: 'sk-log-secret-key-123' });
    await t.api('POST', `/api/providers/${provider.id}/keys`, { key: 'sk-log-secret-key-123' });
    await t.api('POST', `/api/providers/${provider.id}/keys/bulk`, {
      text: 'sk-log-secret-key-456|http://user:hunter2@9.9.9.9:8080\nsk-bad key|x',
    });
    await t.api('POST', '/api/proxies', { url: 'socks5://u:hunter3@8.8.8.8:1080' });
    await t.api('POST', '/api/proxies', { url: 'socks5://u:hunter3@8.8.8.8:1080' });
    await t.api('POST', '/api/proxies', { url: 'ftp://u:hunter4@8.8.8.8:21' });
    await t.api('POST', '/api/proxies/bulk', { text: 'gate.example.com:7000:zone-a:hunter5' });
    const { accessToken } = (await t.api('POST', '/api/endpoints', { name: 'Logged' })).json;
    await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong-password-123' } });

    const output = t.logs.join('');
    expect(output).toContain('Bulk key import finished');
    expect(output).toContain('Failed admin login');
    const secrets = [
      'sk-log-secret-key',
      'hunter2',
      'hunter3',
      'hunter4',
      'hunter5',
      accessToken,
      ADMIN.password,
      'wrong-password-123',
      t.config.masterKey.toString('hex'),
    ];
    for (const secret of secrets) expect(output).not.toContain(secret);
  });
});

describe('web UI serving', () => {
  it('serves the built UI with an SPA fallback and keeps API 404s as JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcproute-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>MCPRoute</title>');
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log("ui")');
    const web = await createTestContext({ WEB_DIST_DIR: dir });
    try {
      const index = await web.app.inject({ method: 'GET', url: '/' });
      expect(index.statusCode).toBe(200);
      expect(index.body).toContain('<title>MCPRoute</title>');
      expect(index.headers['cache-control']).toBe('no-cache');

      const asset = await web.app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

      const deepLink = await web.app.inject({ method: 'GET', url: '/providers/123', headers: { accept: 'text/html' } });
      expect(deepLink.statusCode).toBe(200);
      expect(deepLink.body).toContain('<title>MCPRoute</title>');

      expect((await web.app.inject({ method: 'GET', url: '/missing.js' })).statusCode).toBe(404);
      const apiMiss = await web.api('GET', '/api/nope');
      expect(apiMiss.statusCode).toBe(404);
      expect(apiMiss.json).toMatchObject({ statusCode: 404, error: 'Not Found' });
    } finally {
      await web.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
