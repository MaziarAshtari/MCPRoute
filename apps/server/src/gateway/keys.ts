import type { RotationStrategy } from '@mcproute/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { apiKeys, proxies, sessionBindings, type ApiKeyRow, type ProxyRow } from '../db/schema';
import { keyOrder } from '../services/keys';

export interface KeyWithProxy {
  key: ApiKeyRow;
  proxy: ProxyRow | null;
}

/** Fields the rotation strategies look at. */
export interface RotationCandidate {
  id: string;
  weight: number;
  activeSessions: number;
  usageCount: number;
  lastUsedAt: Date | null;
}

export function isCoolingDown(key: ApiKeyRow, now: number): boolean {
  return key.status === 'cooldown' && key.cooldownUntil !== null && key.cooldownUntil.getTime() > now;
}

/**
 * Enabled, not disabled by status, and routable: a key assigned to a disabled proxy is skipped rather than
 * silently sent over a direct connection.
 */
export function isKeyUsable({ key, proxy }: KeyWithProxy): boolean {
  return key.enabled && key.status !== 'disabled' && (key.proxyId === null || proxy?.enabled === true);
}

function selectKeysWithProxy(db: DbExecutor) {
  return db.select({ key: apiKeys, proxy: proxies }).from(apiKeys).leftJoin(proxies, eq(proxies.id, apiKeys.proxyId));
}

export function findKeyWithProxy(db: DbExecutor, keyId: string): KeyWithProxy | null {
  return selectKeysWithProxy(db).where(eq(apiKeys.id, keyId)).get() ?? null;
}

/** Keys that may be bound to a session right now, in insertion order. */
export function availableKeys(db: DbExecutor, providerId: string, now: number, exclude: ReadonlySet<string>): KeyWithProxy[] {
  return selectKeysWithProxy(db)
    .where(and(eq(apiKeys.providerId, providerId), eq(apiKeys.enabled, true), ne(apiKeys.status, 'disabled')))
    .orderBy(...keyOrder)
    .all()
    .filter((row) => !exclude.has(row.key.id) && isKeyUsable(row) && !isCoolingDown(row.key, now));
}

export function boundKey(db: DbExecutor, sessionId: string, providerId: string): KeyWithProxy | null {
  return (
    db
      .select({ key: apiKeys, proxy: proxies })
      .from(sessionBindings)
      .innerJoin(apiKeys, eq(apiKeys.id, sessionBindings.apiKeyId))
      .leftJoin(proxies, eq(proxies.id, apiKeys.proxyId))
      .where(and(eq(sessionBindings.sessionId, sessionId), eq(sessionBindings.providerId, providerId)))
      .get() ?? null
  );
}

const weightOf = (candidate: RotationCandidate) => Math.max(1, candidate.weight);

/** Lower is better: fewest bound sessions per unit of weight, then fewest calls, then longest unused. */
function compareLoad(a: RotationCandidate, b: RotationCandidate): number {
  return (
    a.activeSessions / weightOf(a) - b.activeSessions / weightOf(b) ||
    a.usageCount / weightOf(a) - b.usageCount / weightOf(b) ||
    (a.lastUsedAt?.getTime() ?? 0) - (b.lastUsedAt?.getTime() ?? 0)
  );
}

/**
 * Picks a key for a new binding. Every strategy honours `weight`:
 * - round_robin: smooth weighted round robin (nginx); `state` keeps the per-provider counters.
 * - random: probability proportional to weight.
 * - least_used: lowest activeSessions / weight (ties: usageCount / weight, then oldest lastUsedAt).
 * Ties keep candidate order.
 */
export function pickKey<T extends RotationCandidate>(
  strategy: RotationStrategy,
  candidates: readonly T[],
  state: Map<string, number>,
  random: () => number = Math.random,
): T | null {
  if (candidates.length === 0) return null;

  if (strategy === 'random') {
    const total = candidates.reduce((sum, candidate) => sum + weightOf(candidate), 0);
    let point = random() * total;
    for (const candidate of candidates) {
      point -= weightOf(candidate);
      if (point < 0) return candidate;
    }
    return candidates[candidates.length - 1] ?? null;
  }

  if (strategy === 'least_used') {
    return candidates.reduce((best, candidate) => (compareLoad(candidate, best) < 0 ? candidate : best));
  }

  // Keys that left the rotation (cooldown, disabled, deleted) start from zero when they return.
  const ids = new Set(candidates.map((candidate) => candidate.id));
  for (const id of state.keys()) if (!ids.has(id)) state.delete(id);
  let total = 0;
  let best: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = (state.get(candidate.id) ?? 0) + weightOf(candidate);
    state.set(candidate.id, score);
    total += weightOf(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best) state.set(best.id, bestScore - total);
  return best;
}
