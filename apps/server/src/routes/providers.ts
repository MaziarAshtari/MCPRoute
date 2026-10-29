import {
  idParamsSchema,
  providerConfigSchema,
  providerCreateSchema,
  providerUpdateSchema,
  type RefreshToolsResultDto,
} from '@mcproute/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context';
import { providers } from '../db/schema';
import { NoKeyAvailableError } from '../gateway/session';
import { HttpError, conflict, notFound } from '../lib/errors';
import { toProviderDto } from '../services/dto';
import {
  assertProviderSlugAvailable,
  findProvider,
  keyStatsByProvider,
  providerToConfig,
} from '../services/providers';

export function providerRoutes({ db, gateway }: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/providers', async () => {
      const stats = keyStatsByProvider(db);
      return db
        .select()
        .from(providers)
        .orderBy(asc(providers.name))
        .all()
        .map((row) => toProviderDto(row, stats.get(row.id)));
    });

    app.post('/providers', async (request, reply) => {
      const config = providerCreateSchema.parse(request.body);
      assertProviderSlugAvailable(db, config.slug);
      const row = db.insert(providers).values(config).returning().get();
      request.log.info({ providerId: row.id, slug: row.slug }, 'Provider created');
      return reply.code(201).send(toProviderDto(row));
    });

    app.get('/providers/:id', async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      return toProviderDto(findProvider(db, id), keyStatsByProvider(db, id).get(id));
    });

    app.patch('/providers/:id', async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = findProvider(db, id);
      const patch = providerUpdateSchema.parse(request.body);
      // Cross-field rules are checked on the merged result, not just the patch.
      const config = providerConfigSchema.parse({ ...providerToConfig(existing), ...patch });
      if (config.slug !== existing.slug) assertProviderSlugAvailable(db, config.slug, id);
      const row = db.update(providers).set(config).where(eq(providers.id, id)).returning().get();
      if (!row) throw notFound('Provider');
      return toProviderDto(row, keyStatsByProvider(db, id).get(id));
    });

    /** Fetches tools/list with one available key and stores it as the provider's tool cache. */
    app.post('/providers/:id/refresh-tools', async (request): Promise<RefreshToolsResultDto> => {
      const { id } = idParamsSchema.parse(request.params);
      const provider = findProvider(db, id);
      try {
        const { tools, fetchedAt } = await gateway.refreshProviderTools(provider);
        request.log.info({ providerId: id, toolCount: tools.length }, 'Provider tools refreshed');
        return { tools, toolsFetchedAt: fetchedAt.toISOString() };
      } catch (error) {
        if (error instanceof NoKeyAvailableError) throw conflict(error.message);
        throw new HttpError(502, `Upstream request failed: ${(error as Error).message}`);
      }
    });

    app.delete('/providers/:id', async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      if (db.delete(providers).where(eq(providers.id, id)).run().changes === 0) throw notFound('Provider');
      request.log.info({ providerId: id }, 'Provider deleted');
      return reply.code(204).send();
    });
  };
}
