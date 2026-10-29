import {
  apiKeyCreateSchema,
  apiKeyUpdateSchema,
  assignProxiesSchema,
  bulkKeysImportSchema,
  idParamsSchema,
  type ApiKeyDto,
} from '@mcproute/shared';
import { eq, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context';
import type { DbExecutor } from '../db/client';
import { apiKeys, proxies } from '../db/schema';
import { notFound } from '../lib/errors';
import { toApiKeyDto } from '../services/dto';
import { assertKeyIsNew, assignProxies, importKeys, keyOrder, keySecretFields } from '../services/keys';
import { findProvider } from '../services/providers';
import { assertProxyExists } from '../services/proxies';

/** Bulk text may be up to ~5 MB; Fastify's default body limit is 1 MiB. */
export const BULK_BODY_LIMIT = 6 * 1024 * 1024;

function selectKeys(db: DbExecutor, where: SQL) {
  return db
    .select({ key: apiKeys, proxy: proxies })
    .from(apiKeys)
    .leftJoin(proxies, eq(proxies.id, apiKeys.proxyId))
    .where(where);
}

function getKeyDto(db: DbExecutor, id: string): ApiKeyDto {
  const row = selectKeys(db, eq(apiKeys.id, id)).get();
  if (!row) throw notFound('API key');
  return toApiKeyDto(row.key, row.proxy);
}

export function keyRoutes({ db, secrets }: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/providers/:id/keys', async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      findProvider(db, id);
      return selectKeys(db, eq(apiKeys.providerId, id))
        .orderBy(...keyOrder)
        .all()
        .map((row) => toApiKeyDto(row.key, row.proxy));
    });

    app.post('/providers/:id/keys', async (request, reply) => {
      const { id: providerId } = idParamsSchema.parse(request.params);
      findProvider(db, providerId);
      const input = apiKeyCreateSchema.parse(request.body);
      if (input.proxyId) assertProxyExists(db, input.proxyId);
      const fields = keySecretFields(secrets, input.key);
      assertKeyIsNew(db, providerId, fields.keyHash);

      const row = db
        .insert(apiKeys)
        .values({
          providerId,
          ...fields,
          label: input.label ?? fields.keyMask,
          proxyId: input.proxyId ?? null,
          enabled: input.enabled,
          weight: input.weight,
        })
        .returning({ id: apiKeys.id })
        .get();
      request.log.info({ providerId, apiKeyId: row.id }, 'API key created');
      return reply.code(201).send(getKeyDto(db, row.id));
    });

    app.post('/providers/:id/keys/bulk', { bodyLimit: BULK_BODY_LIMIT }, async (request) => {
      const { id: providerId } = idParamsSchema.parse(request.params);
      findProvider(db, providerId);
      const input = bulkKeysImportSchema.parse(request.body);
      const result = importKeys(db, secrets, providerId, input.text, input.defaultProxyScheme);
      request.log.info(
        {
          providerId,
          created: result.created,
          skipped: result.skipped,
          failed: result.errors.length,
          proxiesCreated: result.proxiesCreated,
        },
        'Bulk key import finished',
      );
      return result;
    });

    app.post('/providers/:id/keys/assign-proxies', async (request) => {
      const { id: providerId } = idParamsSchema.parse(request.params);
      findProvider(db, providerId);
      const input = assignProxiesSchema.parse(request.body);
      const result = assignProxies(db, providerId, input);
      request.log.info({ providerId, mode: input.mode, ...result }, 'Proxies assigned to keys');
      return result;
    });

    app.get('/keys/:id', async (request) => getKeyDto(db, idParamsSchema.parse(request.params).id));

    app.patch('/keys/:id', async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
      if (!existing) throw notFound('API key');
      const patch = apiKeyUpdateSchema.parse(request.body);

      const changes: Partial<typeof apiKeys.$inferInsert> = {};
      if (patch.key !== undefined) {
        const fields = keySecretFields(secrets, patch.key);
        if (fields.keyHash !== existing.keyHash) assertKeyIsNew(db, existing.providerId, fields.keyHash);
        Object.assign(changes, fields);
        // Keep default labels (the masked key) in sync with the new key.
        if (patch.label === undefined && existing.label === existing.keyMask) changes.label = fields.keyMask;
      }
      if (patch.label !== undefined) changes.label = patch.label;
      if (patch.proxyId !== undefined) {
        if (patch.proxyId !== null) assertProxyExists(db, patch.proxyId);
        changes.proxyId = patch.proxyId;
      }
      if (patch.enabled !== undefined) changes.enabled = patch.enabled;
      if (patch.weight !== undefined) changes.weight = patch.weight;
      if (patch.status !== undefined) {
        changes.status = patch.status;
        changes.cooldownUntil =
          patch.status === 'cooldown'
            ? new Date(Date.now() + findProvider(db, existing.providerId).cooldownSeconds * 1000)
            : null;
      }

      if (Object.keys(changes).length > 0) db.update(apiKeys).set(changes).where(eq(apiKeys.id, id)).run();
      return getKeyDto(db, id);
    });

    app.delete('/keys/:id', async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      if (db.delete(apiKeys).where(eq(apiKeys.id, id)).run().changes === 0) throw notFound('API key');
      request.log.info({ apiKeyId: id }, 'API key deleted');
      return reply.code(204).send();
    });
  };
}
