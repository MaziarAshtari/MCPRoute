import type { KeyStats, ProviderConfig } from '@mcproute/shared';
import { count, eq, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { apiKeys, providers, type ProviderRow } from '../db/schema';
import { conflict, notFound } from '../lib/errors';

export function findProvider(db: DbExecutor, id: string): ProviderRow {
  const row = db.select().from(providers).where(eq(providers.id, id)).get();
  if (!row) throw notFound('Provider');
  return row;
}

export function assertProviderSlugAvailable(db: DbExecutor, slug: string, exceptId?: string): void {
  const row = db.select({ id: providers.id }).from(providers).where(eq(providers.slug, slug)).get();
  if (row && row.id !== exceptId) throw conflict(`Slug "${slug}" is already used by another provider`);
}

/** The editable configuration of a stored provider (used to merge PATCH requests). */
export function providerToConfig(row: ProviderRow): ProviderConfig {
  return {
    name: row.name,
    slug: row.slug,
    description: row.description,
    transport: row.transport,
    url: row.url,
    command: row.command,
    args: row.args,
    env: row.env,
    authMode: row.authMode,
    authHeaderName: row.authHeaderName,
    authValueTemplate: row.authValueTemplate,
    authQueryParam: row.authQueryParam,
    rotationStrategy: row.rotationStrategy,
    failoverEnabled: row.failoverEnabled,
    cooldownSeconds: row.cooldownSeconds,
    failureRules: row.failureRules,
    enabled: row.enabled,
  };
}

const countWhere = (condition: SQL | undefined) =>
  sql<number>`coalesce(sum(case when ${condition} then 1 else 0 end), 0)`.mapWith(Number);

/** Key counts per provider (all providers, or just one). */
export function keyStatsByProvider(db: DbExecutor, providerId?: string): Map<string, KeyStats> {
  const rows = db
    .select({
      providerId: apiKeys.providerId,
      total: count(),
      enabled: countWhere(eq(apiKeys.enabled, true)),
      active: countWhere(eq(apiKeys.status, 'active')),
      cooldown: countWhere(eq(apiKeys.status, 'cooldown')),
      disabled: countWhere(eq(apiKeys.status, 'disabled')),
    })
    .from(apiKeys)
    .where(providerId ? eq(apiKeys.providerId, providerId) : undefined)
    .groupBy(apiKeys.providerId)
    .all();
  return new Map(rows.map(({ providerId: id, ...stats }) => [id, stats]));
}
