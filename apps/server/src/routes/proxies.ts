import { bulkProxiesImportSchema, idParamsSchema, proxyCreateSchema, proxyUpdateSchema } from '@mcproute/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context';
import { proxies } from '../db/schema';
import { notFound } from '../lib/errors';
import { toProxyDto } from '../services/dto';
import {
  assertProxyUrlAvailable,
  findProxy,
  importProxies,
  proxyKeyCounts,
} from '../services/proxies';
import { BULK_BODY_LIMIT } from './keys';

export function proxyRoutes({ db }: AppContext): FastifyPluginAsync {
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
