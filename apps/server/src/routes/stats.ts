import type { StatsOverviewDto } from '@mcproute/shared';
import { and, count, eq, gt, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context';
import { apiKeys, providers, proxies, requestLogs, sessions } from '../db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;

const countWhere = (condition: SQL | undefined) =>
  sql<number>`coalesce(sum(case when ${condition} then 1 else 0 end), 0)`.mapWith(Number);

export function statsRoutes({ db }: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/stats/overview', async (): Promise<StatsOverviewDto> => {
      const now = new Date();
      // A cooldown that has passed counts as active even before the maintenance job flips the status.
      const cooldownOver = and(eq(apiKeys.status, 'cooldown'), lte(apiKeys.cooldownUntil, now));
      const keys = db
        .select({
          total: count(),
          enabled: countWhere(eq(apiKeys.enabled, true)),
          active: countWhere(or(eq(apiKeys.status, 'active'), cooldownOver)),
          cooldown: countWhere(and(eq(apiKeys.status, 'cooldown'), gt(apiKeys.cooldownUntil, now))),
          disabled: countWhere(eq(apiKeys.status, 'disabled')),
        })
        .from(apiKeys)
        .get();
      const providerTotals = db
        .select({ total: count(), enabled: countWhere(eq(providers.enabled, true)) })
        .from(providers)
        .get();
      const proxyTotals = db
        .select({
          total: count(),
          enabled: countWhere(eq(proxies.enabled, true)),
          ok: countWhere(eq(proxies.status, 'ok')),
          failed: countWhere(eq(proxies.status, 'failed')),
          unknown: countWhere(eq(proxies.status, 'unknown')),
        })
        .from(proxies)
        .get();
      const activeSessions = db.select({ total: count() }).from(sessions).where(gt(sessions.expiresAt, now)).get();
      const requests = db
        .select({ total: count(), error: countWhere(eq(requestLogs.status, 'error')) })
        .from(requestLogs)
        .where(gte(requestLogs.createdAt, new Date(now.getTime() - DAY_MS)))
        .get();

      const requestTotal = requests?.total ?? 0;
      const requestErrors = requests?.error ?? 0;
      return {
        providers: { total: providerTotals?.total ?? 0, enabled: providerTotals?.enabled ?? 0 },
        keys: {
          total: keys?.total ?? 0,
          enabled: keys?.enabled ?? 0,
          active: keys?.active ?? 0,
          cooldown: keys?.cooldown ?? 0,
          disabled: keys?.disabled ?? 0,
        },
        proxies: {
          total: proxyTotals?.total ?? 0,
          enabled: proxyTotals?.enabled ?? 0,
          ok: proxyTotals?.ok ?? 0,
          failed: proxyTotals?.failed ?? 0,
          unknown: proxyTotals?.unknown ?? 0,
        },
        sessions: { active: activeSessions?.total ?? 0 },
        requests24h: {
          total: requestTotal,
          ok: requestTotal - requestErrors,
          error: requestErrors,
          errorRate: requestTotal === 0 ? 0 : Math.round((requestErrors / requestTotal) * 10_000) / 10_000,
        },
      };
    });
  };
}
