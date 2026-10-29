import {
  endpointCreateSchema,
  endpointUpdateSchema,
  idParamsSchema,
  setEndpointProvidersSchema,
  type EndpointWithTokenDto,
} from '@mcproute/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context';
import { endpointProviders, endpoints, providers } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { toEndpointDto } from '../services/dto';
import {
  assertEndpointSlugAvailable,
  endpointLinks,
  findEndpoint,
  getEndpointDto,
  issueAccessToken,
} from '../services/endpoints';

export function endpointRoutes({ db }: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/endpoints', async () => {
      const links = endpointLinks(db);
      return db
        .select()
        .from(endpoints)
        .orderBy(asc(endpoints.name))
        .all()
        .map((row) => toEndpointDto(row, links.get(row.id) ?? []));
    });

    app.post('/endpoints', async (request, reply) => {
      const input = endpointCreateSchema.parse(request.body);
      assertEndpointSlugAvailable(db, input.slug);
      const token = issueAccessToken();
      const row = db
        .insert(endpoints)
        .values({ ...input, accessTokenHash: token.hash, accessTokenHint: token.hint })
        .returning()
        .get();
      request.log.info({ endpointId: row.id, slug: row.slug }, 'Endpoint created');
      const body: EndpointWithTokenDto = { ...toEndpointDto(row, []), accessToken: token.token };
      return reply.code(201).send(body);
    });

    app.get('/endpoints/:id', async (request) => getEndpointDto(db, idParamsSchema.parse(request.params).id));

    app.patch('/endpoints/:id', async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = findEndpoint(db, id);
      const patch = endpointUpdateSchema.parse(request.body);
      if (patch.slug !== undefined && patch.slug !== existing.slug) assertEndpointSlugAvailable(db, patch.slug, id);
      if (Object.keys(patch).length > 0) db.update(endpoints).set(patch).where(eq(endpoints.id, id)).run();
      return getEndpointDto(db, id);
    });

    app.delete('/endpoints/:id', async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      if (db.delete(endpoints).where(eq(endpoints.id, id)).run().changes === 0) throw notFound('Endpoint');
      request.log.info({ endpointId: id }, 'Endpoint deleted');
      return reply.code(204).send();
    });

    app.post('/endpoints/:id/regenerate-token', async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      findEndpoint(db, id);
      const token = issueAccessToken();
      db.update(endpoints)
        .set({ accessTokenHash: token.hash, accessTokenHint: token.hint })
        .where(eq(endpoints.id, id))
        .run();
      request.log.info({ endpointId: id }, 'Endpoint access token regenerated');
      const body: EndpointWithTokenDto = { ...getEndpointDto(db, id), accessToken: token.token };
      return body;
    });

    app.put('/endpoints/:id/providers', async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      findEndpoint(db, id);
      const { providers: links } = setEndpointProvidersSchema.parse(request.body);

      const providerIds = links.map((link) => link.providerId);
      if (providerIds.length > 0) {
        const found = new Set(
          db
            .select({ id: providers.id })
            .from(providers)
            .where(inArray(providers.id, providerIds))
            .all()
            .map((row) => row.id),
        );
        const missing = providerIds.filter((providerId) => !found.has(providerId));
        if (missing.length > 0) throw badRequest(`Unknown provider IDs: ${missing.join(', ')}`);
      }

      db.transaction((tx) => {
        tx.delete(endpointProviders).where(eq(endpointProviders.endpointId, id)).run();
        if (links.length > 0) {
          tx.insert(endpointProviders)
            .values(links.map((link) => ({ endpointId: id, ...link })))
            .run();
        }
        tx.update(endpoints).set({ updatedAt: new Date() }).where(eq(endpoints.id, id)).run();
      });
      return getEndpointDto(db, id);
    });
  };
}
