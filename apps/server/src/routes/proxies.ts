import {
  bulkProxiesImportSchema,
  idParamsSchema,
  proxyCreateSchema,
  proxyUpdateSchema,
  type ProxyCheckAllResultDto,
  type ProxyCheckResultDto,
} from '@mcproute/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context';
import { proxies, type ProxyRow } from '../db/schema';
import { checkProxy } from '../gateway/proxy';
import { mapConcurrent } from '../lib/concurrency';
import { notFound } from '../lib/errors';
import { toProxyDto } from '../services/dto';
import {
  assertProxyUrlAvailable,
  findProxy,
  importProxies,
  proxyKeyCounts,
} from '../services/proxies';
import { BULK_BODY_LIMIT } from './keys';

const CHECK_CONCURRENCY = 10;

export function proxyRoutes({ db, config }: AppContext): FastifyPluginAsync {
  /** Requests PROXY_CHECK_URL through the proxy and stores the outcome as the proxy's health status. */
  async function check(proxy: ProxyRow): Promise<ProxyCheckResultDto> {
    const outcome = await checkProxy(proxy.url, config.proxyCheckUrl, config.upstreamConnectTimeoutMs);
    const checkedAt = new Date();
    const status = outcome.ok ? 'ok' : 'failed';
    db.update(proxies)
      .set({ status, lastCheckedAt: checkedAt, lastLatencyMs: outcome.latencyMs, lastError: outcome.error })
      .where(eq(proxies.id, proxy.id))
      .run();
    return {
      proxyId: proxy.id,
      ok: outcome.ok,
      status,
      exitIp: outcome.exitIp,
      latencyMs: outcome.latencyMs,
      error: outcome.error,
      checkedAt: checkedAt.toISOString(),
    };
  }

  return async (app) => {
    app.get('/proxies', async () => {
      const counts = proxyKeyCounts(db);
      return db
        .select()
        .from(proxies)
        .orderBy(asc(proxies.createdAt), asc(sql`${proxies}.rowid`))
        .all()
        .map((row) => toProxyDto(row, counts.get(row.id) ?? 0));
    });

    app.post('/proxies', async (request, reply) => {
      const input = proxyCreateSchema.parse(request.body);
      assertProxyUrlAvailable(db, input.url);
      const row = db
        .insert(proxies)
        .values({ url: input.url, label: input.label ?? null, enabled: input.enabled })
        .returning()
        .get();
      request.log.info({ proxyId: row.id }, 'Proxy created');
      return reply.code(201).send(toProxyDto(row, 0));
    });

    app.post('/proxies/bulk', { bodyLimit: BULK_BODY_LIMIT }, async (request) => {
      const input = bulkProxiesImportSchema.parse(request.body);
      const result = importProxies(db, input.text, input.defaultScheme);
      request.log.info(
        { created: result.created, skipped: result.skipped, failed: result.errors.length },
        'Bulk proxy import finished',
      );
      return result;
    });

    app.post('/proxies/check-all', async (request): Promise<ProxyCheckAllResultDto> => {
      const rows = db.select().from(proxies).orderBy(asc(proxies.createdAt), asc(sql`${proxies}.rowid`)).all();
      const results = await mapConcurrent(rows, CHECK_CONCURRENCY, check);
      const ok = results.filter((result) => result.ok).length;
      request.log.info({ total: results.length, ok, failed: results.length - ok }, 'Proxy health check finished');
      return { total: results.length, ok, failed: results.length - ok, results };
    });

    app.post('/proxies/:id/check', async (request): Promise<ProxyCheckResultDto> => {
      const { id } = idParamsSchema.parse(request.params);
      return check(findProxy(db, id));
    });

    app.get('/proxies/:id', async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      return toProxyDto(findProxy(db, id), proxyKeyCounts(db, id).get(id) ?? 0);
    });

    app.patch('/proxies/:id', async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = findProxy(db, id);
      const patch = proxyUpdateSchema.parse(request.body);

      const changes: Partial<typeof proxies.$inferInsert> = {};
      if (patch.url !== undefined && patch.url !== existing.url) {
        assertProxyUrlAvailable(db, patch.url, id);
        // A different proxy: previous health information no longer applies.
        Object.assign(changes, { url: patch.url, status: 'unknown', lastCheckedAt: null, lastLatencyMs: null, lastError: null });
      }
      if (patch.label !== undefined) changes.label = patch.label;
      if (patch.enabled !== undefined) changes.enabled = patch.enabled;

      if (Object.keys(changes).length > 0) db.update(proxies).set(changes).where(eq(proxies.id, id)).run();
      return toProxyDto(findProxy(db, id), proxyKeyCounts(db, id).get(id) ?? 0);
    });

    app.delete('/proxies/:id', async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      // Keys using this proxy fall back to a direct connection (proxy_id is set to NULL).
      if (db.delete(proxies).where(eq(proxies.id, id)).run().changes === 0) throw notFound('Proxy');
      request.log.info({ proxyId: id }, 'Proxy deleted');
      return reply.code(204).send();
    });
  };
}
