import {
  parseBulkKeys,
  type AssignProxiesResult,
  type BulkKeysImportResult,
  type DefaultProxyScheme,
  type ProxyAssignMode,
} from '@mcproute/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase, DbExecutor } from '../db/client';
import { apiKeys, proxies } from '../db/schema';
import { maskSecret, type SecretBox } from '../lib/crypto';
import { badRequest, conflict } from '../lib/errors';
import { upsertProxy } from './proxies';

/** Encrypted value, duplicate-detection fingerprint and display mask for a plaintext key. */
export function keySecretFields(secrets: SecretBox, plaintext: string) {
  return {
    key: secrets.encrypt(plaintext),
    keyHash: secrets.fingerprint(plaintext),
    keyMask: maskSecret(plaintext),
  };
}

export function assertKeyIsNew(db: DbExecutor, providerId: string, keyHash: string): void {
  const row = db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.providerId, providerId), eq(apiKeys.keyHash, keyHash)))
    .get();
  if (row) throw conflict('This key already exists for this provider');
}

/** Insertion order (rowid) breaks ties between rows created in the same millisecond. */
export const keyOrder = [asc(apiKeys.createdAt), asc(sql`${apiKeys}.rowid`)];

/**
 * Bulk key import. Lines are `key`, `key|proxyUrl` or `key|proxyUrl|label`; inline proxies are
 * upserted into the pool (de-duplicated by canonical URL). Keys already stored for the provider, or
 * repeated in the input, are skipped. Everything runs in one transaction.
 */
export function importKeys(
  db: AppDatabase,
  secrets: SecretBox,
  providerId: string,
  text: string,
  defaultProxyScheme: DefaultProxyScheme,
): BulkKeysImportResult {
  const { entries, errors } = parseBulkKeys(text, { defaultProxyScheme });

  return db.transaction((tx) => {
    const knownHashes = new Set(
      tx
        .select({ keyHash: apiKeys.keyHash })
        .from(apiKeys)
        .where(eq(apiKeys.providerId, providerId))
        .all()
        .map((row) => row.keyHash),
    );
    const proxyIdsByUrl = new Map<string, string>();
    let created = 0;
    let skipped = 0;
    let proxiesCreated = 0;

    for (const entry of entries) {
      const fields = keySecretFields(secrets, entry.key);
      if (knownHashes.has(fields.keyHash)) {
        skipped += 1;
        continue;
      }
      knownHashes.add(fields.keyHash);

      let proxyId: string | null = null;
      if (entry.proxy) {
        proxyId = proxyIdsByUrl.get(entry.proxy.url) ?? null;
        if (proxyId === null) {
          const proxy = upsertProxy(tx, entry.proxy.url);
          proxyId = proxy.id;
          proxyIdsByUrl.set(entry.proxy.url, proxy.id);
          if (proxy.created) proxiesCreated += 1;
        }
      }

      tx.insert(apiKeys)
        .values({ providerId, ...fields, label: entry.label ?? fields.keyMask, proxyId })
        .run();
      created += 1;
    }

    return { created, skipped, proxiesCreated, errors };
  });
}

/**
 * Pure planner for proxy assignment; returns one proxy id (or null) per key, in key order.
 * - round_robin: each key takes the least-loaded proxy (ties broken by pool order), counting proxies
 *   kept by keys outside the target set. From an empty start this is plain round robin.
 * - random: a uniformly random proxy per key.
 * - one_to_one: every proxy serves at most one of the provider's keys; surplus keys get none.
 */
export function planProxyAssignment(
  mode: ProxyAssignMode,
  keyCount: number,
  poolIds: readonly string[],
  keptProxyIds: readonly string[] = [],
  random: () => number = Math.random,
): (string | null)[] {
  if (poolIds.length === 0) return Array.from({ length: keyCount }, () => null);

  if (mode === 'random') {
    return Array.from({ length: keyCount }, () => poolIds[Math.floor(random() * poolIds.length)] ?? null);
  }

  if (mode === 'one_to_one') {
    const taken = new Set(keptProxyIds);
    const free = poolIds.filter((id) => !taken.has(id));
    return Array.from({ length: keyCount }, (_, index) => free[index] ?? null);
  }

  // Level filling: every proxy at the current minimum load receives one key (in pool order),
  // then the level rises and proxies already at that load join. Equivalent to repeatedly
  // picking the least-loaded proxy, in O(keys + proxies log proxies).
  const load = new Map(poolIds.map((id) => [id, 0]));
  for (const id of keptProxyIds) {
    const current = load.get(id);
    if (current !== undefined) load.set(id, current + 1);
  }
  const byLoad = poolIds
    .map((id, position) => ({ id, position, load: load.get(id) ?? 0 }))
    .sort((a, b) => a.load - b.load || a.position - b.position);

  const plan: string[] = [];
  const active: typeof byLoad = [];
  let next = 0;
  let level = byLoad[0]?.load ?? 0;
  while (plan.length < keyCount) {
    let joined = false;
    for (let candidate = byLoad[next]; candidate && candidate.load <= level; candidate = byLoad[next]) {
      active.push(candidate);
      next += 1;
      joined = true;
    }
    if (joined) active.sort((a, b) => a.position - b.position);
    for (const proxy of active) {
      if (plan.length === keyCount) break;
      plan.push(proxy.id);
    }
    level += 1;
  }
  return plan;
}

/** Enabled proxies to assign from: the given ids (in order) or the whole pool. */
function resolveProxyPool(db: DbExecutor, proxyIds: string[] | undefined): string[] {
  if (!proxyIds || proxyIds.length === 0) {
    return db
      .select({ id: proxies.id })
      .from(proxies)
      .where(eq(proxies.enabled, true))
      .orderBy(asc(proxies.createdAt), asc(sql`${proxies}.rowid`))
      .all()
      .map((row) => row.id);
  }
  const requested = [...new Set(proxyIds)];
  const rows = db
    .select({ id: proxies.id, enabled: proxies.enabled })
    .from(proxies)
    .where(inArray(proxies.id, requested))
    .all();
  const enabledById = new Map(rows.map((row) => [row.id, row.enabled]));
  const missing = requested.filter((id) => !enabledById.has(id));
  if (missing.length > 0) {
    throw badRequest(`Unknown proxy IDs: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`);
  }
  return requested.filter((id) => enabledById.get(id) === true);
}

export interface AssignProxiesOptions {
  mode: ProxyAssignMode;
  proxyIds?: string[];
  onlyUnassigned: boolean;
}

/** Assigns proxies to a provider's keys. Disabled proxies are never assigned. */
export function assignProxies(
  db: AppDatabase,
  providerId: string,
  options: AssignProxiesOptions,
  random: () => number = Math.random,
): AssignProxiesResult {
  return db.transaction((tx) => {
    const pool = resolveProxyPool(tx, options.proxyIds);
    if (pool.length === 0) throw badRequest('No enabled proxies available to assign');

    const keys = tx
      .select({ id: apiKeys.id, proxyId: apiKeys.proxyId })
      .from(apiKeys)
      .where(eq(apiKeys.providerId, providerId))
      .orderBy(...keyOrder)
      .all();
    const targets = options.onlyUnassigned ? keys.filter((key) => key.proxyId === null) : keys;
    const kept = options.onlyUnassigned ? keys.flatMap((key) => (key.proxyId ? [key.proxyId] : [])) : [];
    const plan = planProxyAssignment(options.mode, targets.length, pool, kept, random);

    let assigned = 0;
    targets.forEach((key, index) => {
      const proxyId = plan[index] ?? null;
      if (proxyId !== null) assigned += 1;
      if (proxyId !== key.proxyId) tx.update(apiKeys).set({ proxyId }).where(eq(apiKeys.id, key.id)).run();
    });
    return { assigned, unassigned: targets.length - assigned };
  });
}
