import { randomUUID } from 'node:crypto';
import type { KeyTestResultDto, McpToolDefinition } from '@mcproute/shared';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { and, asc, eq, gt, lt, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Dispatcher } from 'undici';
import type { AppConfig } from '../config';
import type { AppDatabase } from '../db/client';
import {
  endpointProviders,
  endpoints,
  providers,
  requestLogs,
  sessionBindings,
  sessions,
  type EndpointRow,
  type ProviderRow,
} from '../db/schema';
import type { SecretBox } from '../lib/crypto';
import { safeErrorText, truncate } from '../lib/redact';
import {
  reactivateExpiredCooldowns,
  recordKeyFailure,
  recordKeyUsage,
  syncActiveSessions,
} from '../services/keys';
import { deleteSessionRecords } from '../services/sessions';
import { safeUpstreamError } from './failure';
import { availableKeys, boundKey, pickKey, type KeyWithProxy } from './keys';
import { createDirectDispatcher } from './proxy';
import { GatewaySession, NoKeyAvailableError, type EndpointContext } from './session';
import { connectionSecrets, connectUpstream, listAllTools, type UpstreamConnection } from './upstream';

export interface GatewayOptions {
  /** Interval of SSE keep-alive comments on downstream streams (keeps reverse proxies from timing out). */
  keepAliveMs: number;
  /** How often idle sessions, expired cooldowns and old request logs are cleaned up. */
  maintenanceIntervalMs: number;
  /** Cached tool lists older than this are refreshed in the background. */
  toolsCacheTtlMs: number;
}

export const DEFAULT_GATEWAY_OPTIONS: GatewayOptions = {
  keepAliveMs: 25_000,
  maintenanceIntervalMs: 60_000,
  toolsCacheTtlMs: 24 * 60 * 60 * 1000,
};

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

export interface GatewayDeps {
  config: AppConfig;
  db: AppDatabase;
  secrets: SecretBox;
  logger: FastifyBaseLogger;
}

type RequestLogEntry = Omit<typeof requestLogs.$inferInsert, 'id' | 'createdAt'>;

/** The MCP gateway engine: downstream sessions, key affinity, upstream connections and background jobs. */
export class Gateway {
  readonly config: AppConfig;
  readonly db: AppDatabase;
  readonly logger: FastifyBaseLogger;
  readonly options: GatewayOptions;
  readonly #secrets: SecretBox;
  readonly #sessions = new Map<string, GatewaySession>();
  readonly #restoring = new Map<string, Promise<GatewaySession | null>>();
  /** Smooth weighted round-robin counters, per provider. */
  readonly #rotation = new Map<string, Map<string, number>>();
  readonly #toolRefreshes = new Map<string, Promise<unknown>>();
  /** Capabilities announced by each provider, learned from any upstream connection since start. */
  readonly #capabilities = new Map<string, ServerCapabilities>();
  readonly #directDispatcher: Dispatcher;
  #timer: NodeJS.Timeout | undefined;
  #lastRetentionRun = 0;
  #closing = false;

  constructor(deps: GatewayDeps, options: Partial<GatewayOptions> = {}) {
    this.config = deps.config;
    this.db = deps.db;
    this.logger = deps.logger;
    this.#secrets = deps.secrets;
    this.options = { ...DEFAULT_GATEWAY_OPTIONS, ...options };
    this.#directDispatcher = createDirectDispatcher(this.config.upstreamConnectTimeoutMs);
  }

  get liveSessionCount(): number {
    return this.#sessions.size;
  }

  start(): void {
    if (this.#timer) return;
    this.runMaintenance();
    this.#timer = setInterval(() => this.runMaintenance(), this.options.maintenanceIntervalMs);
    this.#timer.unref();
  }

  /**
   * Shutdown: closes live sessions without deleting them, so Streamable HTTP sessions (and their key
   * bindings) are restored when clients come back after a restart. SSE sessions cannot be resumed.
   */
  async close(): Promise<void> {
    this.#closing = true;
    clearInterval(this.#timer);
    this.#timer = undefined;
    const live = [...this.#sessions.values()];
    this.#sessions.clear();
    for (const session of live) if (session.kind === 'sse') deleteSessionRecords(this.db, session.id);
    await Promise.allSettled(live.map((session) => session.close()));
    await Promise.allSettled([...this.#toolRefreshes.values()]);
    await this.#directDispatcher.destroy().catch(() => undefined);
  }

  // ------------------------------------------------------------------------------------------- endpoints

  findEndpointBySlug(slug: string): EndpointRow | null {
    return this.db.select().from(endpoints).where(eq(endpoints.slug, slug)).get() ?? null;
  }

  endpointContext(endpointId: string): EndpointContext | null {
    const endpoint = this.db.select().from(endpoints).where(eq(endpoints.id, endpointId)).get();
    if (!endpoint) return null;
    const links = this.db
      .select({ provider: providers, toolFilterMode: endpointProviders.toolFilterMode, toolNames: endpointProviders.toolNames })
      .from(endpointProviders)
      .innerJoin(providers, eq(providers.id, endpointProviders.providerId))
      .where(and(eq(endpointProviders.endpointId, endpointId), eq(providers.enabled, true)))
      .orderBy(asc(providers.name), asc(providers.slug))
      .all();
    return { endpoint, links };
  }

  // -------------------------------------------------------------------------------------------- sessions

  /** A new Streamable HTTP session; registered only once its `initialize` request succeeded. */
  createStreamableSession(endpoint: EndpointRow, id: string = randomUUID()): GatewaySession {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => id,
      keepAliveMs: this.options.keepAliveMs,
      // DELETE /mcp/{slug}: the client ends its session.
      onsessionclosed: (sessionId) => {
        this.endSession(sessionId, 'closed by client');
      },
    });
    const session = new GatewaySession(this, id, endpoint.id, 'streamable', transport, `mcproute/${endpoint.slug}`);
    // Handlers are attached synchronously; start() of this transport cannot fail on a fresh instance.
    session.server.connect(transport).catch((error: unknown) => {
      this.logger.error({ sessionId: id, error: safeErrorText(error) }, 'Could not start MCP session');
    });
    return session;
  }

  registerSession(session: GatewaySession, now: number = Date.now()): void {
    this.#sessions.set(session.id, session);
    this.db
      .insert(sessions)
      .values({
        id: session.id,
        endpointId: session.endpointId,
        createdAt: new Date(now),
        lastSeenAt: new Date(now),
        expiresAt: new Date(now + this.#sessionTtlMs),
      })
      .run();
    this.logger.info({ sessionId: session.id, endpointId: session.endpointId, transport: session.kind }, 'MCP session started');
  }

  /** Legacy SSE session; the transport's own id is the session id. Starts the stream. */
  async openSseSession(endpoint: EndpointRow, transport: SSEServerTransport): Promise<GatewaySession> {
    const session = new GatewaySession(this, transport.sessionId, endpoint.id, 'sse', transport, `mcproute/${endpoint.slug}`);
    this.registerSession(session);
    await session.server.connect(transport);
    return session;
  }

  liveSession(id: string): GatewaySession | undefined {
    return this.#sessions.get(id);
  }

  /**
   * Live session for a Streamable HTTP request, or the persisted one rebuilt after a restart (same key
   * bindings). Null when unknown, expired or owned by another endpoint.
   */
  async findSession(id: string, endpoint: EndpointRow): Promise<GatewaySession | null> {
    const live = this.#sessions.get(id);
    if (live) return live.endpointId === endpoint.id && live.kind === 'streamable' && !live.closed ? live : null;
    if (this.#closing) return null;
    let pending = this.#restoring.get(id);
    if (!pending) {
      pending = this.#restore(id, endpoint).finally(() => this.#restoring.delete(id));
      this.#restoring.set(id, pending);
    }
    const session = await pending;
    return session && session.endpointId === endpoint.id ? session : null;
  }

  async #restore(id: string, endpoint: EndpointRow): Promise<GatewaySession | null> {
    const row = this.db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!row || row.endpointId !== endpoint.id || row.expiresAt.getTime() <= Date.now()) return null;
    const session = this.createStreamableSession(endpoint, id);
    try {
      await session.replayInitialize();
    } catch (error) {
      this.logger.warn({ sessionId: id, error: safeErrorText(error) }, 'Could not restore MCP session');
      await session.close();
      return null;
    }
    if (this.#closing) {
      await session.close();
      return null;
    }
    this.#sessions.set(id, session);
    this.logger.info({ sessionId: id, endpointId: endpoint.id }, 'MCP session restored');
    return session;
  }

  /** Marks activity. False when the session expired or was deleted meanwhile (it is ended then). */
  touch(session: GatewaySession, now: number = Date.now()): boolean {
    const { changes } = this.db
      .update(sessions)
      .set({ lastSeenAt: new Date(now), expiresAt: new Date(now + this.#sessionTtlMs) })
      .where(and(eq(sessions.id, session.id), gt(sessions.expiresAt, new Date(now))))
      .run();
    if (changes > 0) return true;
    this.endSession(session.id, 'expired');
    return false;
  }

  /** Ends a session: deletes it with its bindings (releasing the keys) and closes live connections. */
  endSession(id: string, reason: string): boolean {
    const live = this.#sessions.get(id);
    this.#sessions.delete(id);
    const deleted = deleteSessionRecords(this.db, id);
    if (live) {
      live.close({ terminateUpstream: true }).catch((error: unknown) => {
        this.logger.warn({ sessionId: id, error: safeErrorText(error) }, 'Error while closing MCP session');
      });
    }
    if (deleted || live) this.logger.info({ sessionId: id, reason }, 'MCP session ended');
    return deleted || live !== undefined;
  }

  /** The downstream transport closed on its own (SSE client disconnected). */
  handleTransportClosed(session: GatewaySession): void {
    if (this.#sessions.get(session.id) === session) this.endSession(session.id, 'disconnected');
  }

  get #sessionTtlMs(): number {
    return this.config.sessionTtlMinutes * 60_000;
  }

  // ------------------------------------------------------------------------------------------------ keys

  /** Picks a key for a new binding using the provider's rotation strategy. */
  selectKey(provider: ProviderRow, exclude: ReadonlySet<string> = new Set()): KeyWithProxy | null {
    const now = Date.now();
    reactivateExpiredCooldowns(this.db, new Date(now), provider.id);
    const candidates = availableKeys(this.db, provider.id, now, exclude);
    let state = this.#rotation.get(provider.id);
    if (!state) {
      state = new Map();
      this.#rotation.set(provider.id, state);
    }
    const picked = pickKey(
      provider.rotationStrategy,
      candidates.map((row) => row.key),
      state,
    );
    return candidates.find((row) => row.key.id === picked?.id) ?? null;
  }

  boundKey(sessionId: string, providerId: string): KeyWithProxy | null {
    return boundKey(this.db, sessionId, providerId);
  }

  /** Binds (or rebinds) the session's key for a provider and updates the keys' active-session counts. */
  bindKey(sessionId: string, providerId: string, apiKeyId: string): void {
    this.db.transaction((tx) => {
      const previous = boundKey(tx, sessionId, providerId);
      tx.insert(sessionBindings)
        .values({ sessionId, providerId, apiKeyId })
        .onConflictDoUpdate({ target: [sessionBindings.sessionId, sessionBindings.providerId], set: { apiKeyId } })
        .run();
      syncActiveSessions(tx, previous ? [apiKeyId, previous.key.id] : [apiKeyId]);
    });
  }

  recordKeyFailure(provider: ProviderRow, apiKeyId: string, message: string): void {
    recordKeyFailure(this.db, apiKeyId, truncate(message), provider.cooldownSeconds, new Date());
  }

  recordRequest(entry: RequestLogEntry): void {
    const now = new Date();
    this.db.insert(requestLogs).values({ ...entry, createdAt: now }).run();
    if (entry.apiKeyId) recordKeyUsage(this.db, entry.apiKeyId, now);
  }

  secretsFor({ key, proxy }: KeyWithProxy): string[] {
    try {
      return connectionSecrets(this.#secrets.decrypt(key.key), proxy?.url ?? null);
    } catch {
      return connectionSecrets('', proxy?.url ?? null);
    }
  }

  async connectUpstream(provider: ProviderRow, { key, proxy }: KeyWithProxy): Promise<UpstreamConnection> {
    const connection = await connectUpstream(
      { provider, apiKey: this.#secrets.decrypt(key.key), proxyUrl: proxy?.url ?? null },
      { connectTimeoutMs: this.config.upstreamConnectTimeoutMs, directDispatcher: this.#directDispatcher, logger: this.logger },
    );
    this.#capabilities.set(provider.id, connection.client.getServerCapabilities() ?? {});
    return connection;
  }

  capabilitiesOf(providerId: string): ServerCapabilities | undefined {
    return this.#capabilities.get(providerId);
  }

  // ----------------------------------------------------------------------------------------------- tools

  isToolCacheStale(provider: ProviderRow, now: number = Date.now()): boolean {
    return provider.toolsFetchedAt === null || now - provider.toolsFetchedAt.getTime() > this.options.toolsCacheTtlMs;
  }

  storeTools(providerId: string, tools: McpToolDefinition[]): Date {
    const fetchedAt = new Date();
    this.db.update(providers).set({ cachedTools: tools, toolsFetchedAt: fetchedAt }).where(eq(providers.id, providerId)).run();
    return fetchedAt;
  }

  /** Connects with one available key, fetches `tools/list` and stores it as the provider's tool cache. */
  async refreshProviderTools(provider: ProviderRow): Promise<{ tools: McpToolDefinition[]; fetchedAt: Date }> {
    const selected = this.selectKey(provider);
    if (!selected) throw new NoKeyAvailableError(provider.name);
    let connection: UpstreamConnection | undefined;
    try {
      connection = await this.connectUpstream(provider, selected);
      const tools = await listAllTools(connection.client, { timeout: this.config.upstreamCallTimeoutMs });
      return { tools, fetchedAt: this.storeTools(provider.id, tools) };
    } catch (error) {
      throw new Error(safeUpstreamError(error, this.secretsFor(selected)));
    } finally {
      await connection?.close({ terminate: true });
    }
  }

  refreshToolsInBackground(provider: ProviderRow): void {
    if (this.#closing || this.#toolRefreshes.has(provider.id)) return;
    const refresh = this.refreshProviderTools(provider)
      .then(({ tools }) => this.logger.info({ providerId: provider.id, toolCount: tools.length }, 'Tool cache refreshed'))
      .catch((error: unknown) =>
        this.logger.warn({ providerId: provider.id, error: safeErrorText(error) }, 'Background tool refresh failed'),
      )
      .finally(() => this.#toolRefreshes.delete(provider.id));
    this.#toolRefreshes.set(provider.id, refresh);
  }

  /** Connects with this key (through its proxy) and runs `tools/list`. Never throws. */
  async testKey(provider: ProviderRow, row: KeyWithProxy): Promise<KeyTestResultDto> {
    const started = performance.now();
    let connection: UpstreamConnection | undefined;
    try {
      connection = await this.connectUpstream(provider, row);
      const tools = await listAllTools(connection.client, { timeout: this.config.upstreamCallTimeoutMs });
      return { ok: true, latencyMs: Math.round(performance.now() - started), toolCount: tools.length, error: null };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        toolCount: null,
        error: safeUpstreamError(error, this.secretsFor(row)),
      };
    } finally {
      await connection?.close({ terminate: true });
    }
  }

  // ----------------------------------------------------------------------------------------- maintenance

  /**
   * Expires idle sessions (closing their upstream clients and releasing keys), drops live sessions whose
   * record was deleted, reactivates keys whose cooldown passed, and applies log retention (hourly).
   */
  runMaintenance(now: number = Date.now()): void {
    try {
      const expired = this.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(lte(sessions.expiresAt, new Date(now)))
        .all();
      for (const { id } of expired) {
        const live = this.#sessions.get(id);
        if (live && live.inFlight > 0) {
          this.touch(live, now);
          continue;
        }
        this.endSession(id, 'idle timeout');
      }

      if (this.#sessions.size > 0) {
        const known = new Set(this.db.select({ id: sessions.id }).from(sessions).all().map((row) => row.id));
        for (const id of [...this.#sessions.keys()]) if (!known.has(id)) this.endSession(id, 'deleted');
      }

      reactivateExpiredCooldowns(this.db, new Date(now));
      syncActiveSessions(this.db);

      if (now - this.#lastRetentionRun >= RETENTION_INTERVAL_MS) {
        this.#lastRetentionRun = now;
        this.deleteOldLogs(now);
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Gateway maintenance failed');
    }
  }

  /** Deletes request logs older than LOG_RETENTION_DAYS. */
  deleteOldLogs(now: number = Date.now()): number {
    const cutoff = new Date(now - this.config.logRetentionDays * 24 * 60 * 60 * 1000);
    const { changes } = this.db.delete(requestLogs).where(lt(requestLogs.createdAt, cutoff)).run();
    if (changes > 0) this.logger.info({ deleted: changes, cutoff: cutoff.toISOString() }, 'Old request logs deleted');
    return changes;
  }
}
