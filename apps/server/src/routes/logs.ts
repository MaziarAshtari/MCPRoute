import { logsQuerySchema, type Paginated, type RequestLogDto } from '@mcproute/shared';
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context';
import { apiKeys, endpoints, providers, requestLogs } from '../db/schema';

export function logRoutes({ db }: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/logs', async (request): Promise<Paginated<RequestLogDto>> => {
      const query = logsQuerySchema.parse(request.query);

      const conditions: SQL[] = [];
      if (query.endpointId) conditions.push(eq(requestLogs.endpointId, query.endpointId));
      if (query.providerId) conditions.push(eq(requestLogs.providerId, query.providerId));
      if (query.apiKeyId) conditions.push(eq(requestLogs.apiKeyId, query.apiKeyId));
      if (query.status) conditions.push(eq(requestLogs.status, query.status));
      if (query.from) conditions.push(gte(requestLogs.createdAt, query.from));
      if (query.to) conditions.push(lte(requestLogs.createdAt, query.to));
      const where = and(...conditions);

      const total = db.select({ total: count() }).from(requestLogs).where(where).get()?.total ?? 0;
      // Left joins: logs outlive the endpoints / providers / keys they reference.
      const rows = db
        .select({
          log: requestLogs,
          endpointName: endpoints.name,
          providerName: providers.name,
          apiKeyLabel: apiKeys.label,
        })
        .from(requestLogs)
        .leftJoin(endpoints, eq(endpoints.id, requestLogs.endpointId))
        .leftJoin(providers, eq(providers.id, requestLogs.providerId))
        .leftJoin(apiKeys, eq(apiKeys.id, requestLogs.apiKeyId))
        .where(where)
        .orderBy(desc(requestLogs.createdAt), desc(requestLogs.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .all();

      return {
        items: rows.map(({ log, endpointName, providerName, apiKeyLabel }) => ({
          id: log.id,
          endpointId: log.endpointId,
          endpointName,
          sessionId: log.sessionId,
          providerId: log.providerId,
          providerName,
          apiKeyId: log.apiKeyId,
          apiKeyLabel,
          proxyId: log.proxyId,
          toolName: log.toolName,
          method: log.method,
          status: log.status,
          latencyMs: log.latencyMs,
          errorMessage: log.errorMessage,
          createdAt: log.createdAt.toISOString(),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  };
}
