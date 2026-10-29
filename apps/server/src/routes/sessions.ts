import {
  sessionIdParamsSchema,
  sessionsQuerySchema,
  type Paginated,
  type SessionBindingDto,
  type SessionDto,
} from '@mcproute/shared';
import { and, asc, count, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context';
import { apiKeys, endpoints, providers, sessionBindings, sessions } from '../db/schema';
import { notFound } from '../lib/errors';

export function sessionRoutes({ db }: AppContext): FastifyPluginAsync {
  return async (app) => {
    /** Sessions that have not expired yet, newest activity first, with their bound keys. */
    app.get('/sessions', async (request): Promise<Paginated<SessionDto>> => {
      const query = sessionsQuerySchema.parse(request.query);
      const conditions: SQL[] = [gt(sessions.expiresAt, new Date())];
      if (query.endpointId) conditions.push(eq(sessions.endpointId, query.endpointId));
      const where = and(...conditions);

      const total = db.select({ total: count() }).from(sessions).where(where).get()?.total ?? 0;
      const rows = db
        .select({ session: sessions, endpointName: endpoints.name, endpointSlug: endpoints.slug })
        .from(sessions)
        .innerJoin(endpoints, eq(endpoints.id, sessions.endpointId))
        .where(where)
        .orderBy(desc(sessions.lastSeenAt), asc(sessions.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .all();

      const bindings = new Map<string, SessionBindingDto[]>();
      if (rows.length > 0) {
        const bindingRows = db
          .select({
            sessionId: sessionBindings.sessionId,
            providerId: sessionBindings.providerId,
            providerName: providers.name,
            providerSlug: providers.slug,
            apiKeyId: sessionBindings.apiKeyId,
            apiKeyLabel: apiKeys.label,
            maskedKey: apiKeys.keyMask,
            proxyId: apiKeys.proxyId,
          })
          .from(sessionBindings)
          .innerJoin(providers, eq(providers.id, sessionBindings.providerId))
          .innerJoin(apiKeys, eq(apiKeys.id, sessionBindings.apiKeyId))
          .where(
            inArray(
              sessionBindings.sessionId,
              rows.map((row) => row.session.id),
            ),
          )
          .orderBy(asc(providers.name))
          .all();
        for (const { sessionId, ...binding } of bindingRows) {
          const list = bindings.get(sessionId) ?? [];
          list.push(binding);
          bindings.set(sessionId, list);
        }
      }

      return {
        items: rows.map(({ session, endpointName, endpointSlug }) => ({
          id: session.id,
          endpointId: session.endpointId,
          endpointName,
          endpointSlug,
          createdAt: session.createdAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          bindings: bindings.get(session.id) ?? [],
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });

    /** Ends a session: its key bindings are dropped and the keys' active-session counters released. */
    app.delete('/sessions/:id', async (request, reply) => {
      const { id } = sessionIdParamsSchema.parse(request.params);
      db.transaction((tx) => {
        const bound = tx
          .select({ apiKeyId: sessionBindings.apiKeyId })
          .from(sessionBindings)
          .where(eq(sessionBindings.sessionId, id))
          .all();
        if (tx.delete(sessions).where(eq(sessions.id, id)).run().changes === 0) throw notFound('Session');
        for (const { apiKeyId } of bound) {
          tx.update(apiKeys)
            .set({ activeSessions: sql`max(${apiKeys.activeSessions} - 1, 0)` })
            .where(eq(apiKeys.id, apiKeyId))
            .run();
        }
      });
      request.log.info({ sessionId: id }, 'Session deleted');
      return reply.code(204).send();
    });
  };
}
