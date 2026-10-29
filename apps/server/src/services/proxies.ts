import { parseBulkProxies, type BulkProxiesImportResult, type DefaultProxyScheme } from '@mcproute/shared';
import { count, eq, isNotNull } from 'drizzle-orm';
import type { AppDatabase, DbExecutor } from '../db/client';
import { apiKeys, proxies, type ProxyRow } from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';

export function findProxy(db: DbExecutor, id: string): ProxyRow {
  const row = db.select().from(proxies).where(eq(proxies.id, id)).get();
  if (!row) throw notFound('Proxy');
  return row;
}

/** For proxy ids referenced from request bodies (400 rather than 404). */
export function assertProxyExists(db: DbExecutor, id: string): void {
  if (!db.select({ id: proxies.id }).from(proxies).where(eq(proxies.id, id)).get()) {
    throw badRequest('Proxy not found');
  }
}

export function assertProxyUrlAvailable(db: DbExecutor, url: string, exceptId?: string): void {
  const row = db.select({ id: proxies.id }).from(proxies).where(eq(proxies.url, url)).get();
  // The URL (with credentials) is deliberately not echoed back.
  if (row && row.id !== exceptId) throw conflict('This proxy already exists');
}

/** Returns the proxy with this canonical URL, creating it when missing. */
export function upsertProxy(db: DbExecutor, url: string): { id: string; created: boolean } {
  const existing = db.select({ id: proxies.id }).from(proxies).where(eq(proxies.url, url)).get();
  if (existing) return { id: existing.id, created: false };
  const inserted = db.insert(proxies).values({ url }).returning({ id: proxies.id }).get();
  return { id: inserted.id, created: true };
}

/** Number of API keys routed through each proxy (all proxies, or just one). */
export function proxyKeyCounts(db: DbExecutor, proxyId?: string): Map<string, number> {
  const rows = db
    .select({ proxyId: apiKeys.proxyId, keys: count() })
    .from(apiKeys)
    .where(proxyId ? eq(apiKeys.proxyId, proxyId) : isNotNull(apiKeys.proxyId))
    .groupBy(apiKeys.proxyId)
    .all();
  return new Map(rows.flatMap((row) => (row.proxyId ? [[row.proxyId, row.keys] as const] : [])));
}

/** Bulk proxy import: invalid lines are reported, duplicates (in the input or the pool) are skipped. */
export function importProxies(db: AppDatabase, text: string, defaultScheme: DefaultProxyScheme): BulkProxiesImportResult {
  const { entries, errors } = parseBulkProxies(text, defaultScheme);
  return db.transaction((tx) => {
    const seen = new Set<string>();
    let created = 0;
    let skipped = 0;
    for (const { proxy } of entries) {
      if (seen.has(proxy.url)) {
        skipped += 1;
        continue;
      }
      seen.add(proxy.url);
      if (upsertProxy(tx, proxy.url).created) created += 1;
      else skipped += 1;
    }
    return { created, skipped, errors };
  });
}
