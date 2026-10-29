import { APP_VERSION, type McpToolDefinition } from '@mcproute/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
  type Prompt,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { EndpointRow, ProviderRow } from '../db/schema';
import { redactSecrets, redactValue, safeErrorText } from '../lib/redact';
import { exposedName, isToolAllowed, splitExposedName, type ToolFilter } from './catalog';
import { classifyError, inspectToolResult, isConnectionLost, safeUpstreamError } from './failure';
import type { Gateway } from './gateway';
import { isCoolingDown, isKeyUsable, type KeyWithProxy } from './keys';
import { listAllPrompts, listAllResources, listAllResourceTemplates, listAllTools, type UpstreamConnection } from './upstream';

/** A key failure triggers at most this many attempts per call (the original key plus two alternatives). */
export const MAX_ATTEMPTS = 3;
const RESOURCE_NOT_FOUND = -32002;
const RESTORE_TIMEOUT_MS = 5_000;

export type SessionKind = 'streamable' | 'sse';

export interface ProviderLink extends ToolFilter {
  provider: ProviderRow;
}

export interface EndpointContext {
  endpoint: EndpointRow;
  /** Enabled linked providers, ordered by name (first one wins on name collisions). */
  links: ProviderLink[];
}

/** Sent to the downstream client as-is: the SDK copies `code`, `message` and `data` into the JSON-RPC error. */
export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
    /** Error response of the upstream server itself (as opposed to one produced by MCPRoute). */
    readonly fromUpstream = false,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

export class NoKeyAvailableError extends Error {
  constructor(providerName: string) {
    super(
      `MCPRoute: no API key is available for provider "${providerName}" ` +
        '(all keys are disabled, cooling down after failures, or assigned to a disabled proxy)',
    );
    this.name = 'NoKeyAvailableError';
  }
}

interface LogOptions {
  /** MCP method, stored in request_logs.method. */
  method: string;
  /** Tool or prompt name, or resource URI, as sent upstream (request_logs.tool_name). */
  target?: string;
  /** Write one request_logs row per attempt and count key usage. */
  logged?: boolean;
}

interface ForwardOptions<T> extends LogOptions {
  /** Tool results: error text (isError) and whether it counts as a key failure. */
  inspect?: (result: T) => { error: string | null; keyFailure: boolean };
}

interface UpstreamSlot {
  /** Key, proxy and connection settings the client was built with; any change forces a reconnect. */
  fingerprint: string;
  promise: Promise<UpstreamConnection>;
  connection?: UpstreamConnection;
}

function connectionFingerprint(provider: ProviderRow, { key, proxy }: KeyWithProxy): string {
  return JSON.stringify([
    key.id,
    key.keyHash,
    proxy?.url ?? null,
    provider.transport,
    provider.url,
    provider.command,
    provider.args,
    provider.env,
    provider.authMode,
    provider.authHeaderName,
    provider.authValueTemplate,
    provider.authQueryParam,
  ]);
}

/**
 * Upstream JSON-RPC errors keep their code, message and data; anything else (transport errors, timeouts)
 * becomes an internal error carrying `message`, the already redacted description.
 */
function downstreamError(error: unknown, message: string, secrets: readonly string[], providerName: string): Error {
  if (error instanceof JsonRpcError) return error;
  if (error instanceof McpError && error.code !== ErrorCode.ConnectionClosed && error.code !== ErrorCode.RequestTimeout) {
    const upstreamMessage = error.message.replace(/^MCP error -?\d+: /, '');
    return new JsonRpcError(error.code, redactSecrets(upstreamMessage, secrets), redactValue(error.data, secrets), true);
  }
  return new JsonRpcError(ErrorCode.InternalError, `Upstream "${providerName}" failed: ${message}`);
}

/**
 * One downstream MCP session. Owns the MCP server the client talks to, plus lazily created upstream
 * clients: one per linked provider, each bound to a single API key (session affinity).
 */
export class GatewaySession {
  readonly server: Server;
  /** POST requests currently being answered; the session is not expired while this is above 0. */
  inFlight = 0;
  #closed = false;
  readonly #upstreams = new Map<string, UpstreamSlot>();
  readonly #promptRoutes = new Map<string, { providerId: string; name: string }>();
  readonly #resourceRoutes = new Map<string, string>();
  #templateRoutes: { template: UriTemplate; providerId: string }[] = [];

  constructor(
    private readonly gateway: Gateway,
    readonly id: string,
    readonly endpointId: string,
    readonly kind: SessionKind,
    readonly transport: WebStandardStreamableHTTPServerTransport | SSEServerTransport,
    serverName: string,
  ) {
    this.server = this.#createServer(serverName);
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** The downstream transport completed `initialize` with this session's id. */
  get initialized(): boolean {
    return this.transport.sessionId === this.id;
  }

  get webTransport(): WebStandardStreamableHTTPServerTransport {
    if (this.kind !== 'streamable') throw new Error('Not a Streamable HTTP session');
    return this.transport as WebStandardStreamableHTTPServerTransport;
  }

  get sseTransport(): SSEServerTransport {
    if (this.kind !== 'sse') throw new Error('Not an SSE session');
    return this.transport as SSEServerTransport;
  }

  /**
   * Rebuilds a persisted session after a restart. The SDK transport only becomes stateful through an
   * `initialize` request, so one is replayed internally with the existing session id; the client then
   * continues with its id as if nothing happened.
   */
  async replayInitialize(): Promise<void> {
    const transport = this.webTransport;
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const response = await transport.handleRequest(new Request('http://mcproute.internal/mcp', { method: 'POST', headers }), {
      parsedBody: {
        jsonrpc: '2.0',
        id: 'mcproute-session-restore',
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'mcproute-session-restore', version: APP_VERSION },
        },
      },
    });
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      response.text(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out replaying initialize')), RESTORE_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!response.ok || !this.initialized) throw new Error(`Replaying initialize failed (HTTP ${response.status})`);
    await transport.handleRequest(
      new Request('http://mcproute.internal/mcp', { method: 'POST', headers: { ...headers, 'mcp-session-id': this.id } }),
      { parsedBody: { jsonrpc: '2.0', method: 'notifications/initialized' } },
    );
  }

  async close({ terminateUpstream = false }: { terminateUpstream?: boolean } = {}): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const slots = [...this.#upstreams.values()];
    this.#upstreams.clear();
    await Promise.allSettled([
      this.server.close(),
      ...slots.map((slot) => slot.promise.then((connection) => connection.close({ terminate: terminateUpstream }))),
    ]);
  }

  #createServer(name: string): Server {
    const server = new Server({ name, version: APP_VERSION }, { capabilities: { tools: {}, prompts: {}, resources: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await this.listTools() }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
      this.callTool(request.params.name, request.params.arguments, extra.signal),
    );
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: await this.listPrompts() }));
    server.setRequestHandler(GetPromptRequestSchema, async (request, extra) =>
      this.getPrompt(request.params.name, request.params.arguments, extra.signal),
    );
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: await this.listResources() }));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: await this.listResourceTemplates(),
    }));
    server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) =>
      this.readResource(request.params.uri, extra.signal),
    );
    server.onclose = () => this.gateway.handleTransportClosed(this);
    return server;
  }

  #context(): EndpointContext {
    const context = this.gateway.endpointContext(this.endpointId);
    if (!context) throw new JsonRpcError(ErrorCode.InvalidRequest, 'This MCP endpoint no longer exists');
    return context;
  }

  // ---------------------------------------------------------------------------------------------- tools

  async listTools(): Promise<Tool[]> {
    const { endpoint, links } = this.#context();
    const lists = await Promise.all(links.map((link) => this.#providerTools(link.provider)));
    const seen = new Set<string>();
    const tools: Tool[] = [];
    links.forEach((link, index) => {
      for (const tool of lists[index] ?? []) {
        if (!isToolAllowed(link, link.provider.slug, tool.name)) continue;
        const name = exposedName(endpoint.toolPrefixMode, link.provider.slug, tool.name);
        if (seen.has(name)) continue;
        seen.add(name);
        tools.push({ ...tool, name } as Tool);
      }
    });
    return tools;
  }

  /** Cached tool list (refreshed in the background once stale), or fetched through this session's key. */
  async #providerTools(provider: ProviderRow): Promise<McpToolDefinition[]> {
    if (provider.cachedTools) {
      if (this.gateway.isToolCacheStale(provider)) this.gateway.refreshToolsInBackground(provider);
      return provider.cachedTools;
    }
    try {
      const tools = await this.#forward(provider, { method: 'tools/list' }, (client, options) =>
        listAllTools(client, options),
      );
      this.gateway.storeTools(provider.id, tools);
      return tools;
    } catch (error) {
      this.gateway.logger.warn(
        { sessionId: this.id, providerId: provider.id, error: safeErrorText(error) },
        'Could not list upstream tools',
      );
      return [];
    }
  }

  async #resolveTool(context: EndpointContext, exposed: string): Promise<{ link: ProviderLink; name: string } | null> {
    const { endpoint, links } = context;
    if (endpoint.toolPrefixMode === 'provider_slug') {
      const parsed = splitExposedName(exposed);
      const link = parsed && links.find((candidate) => candidate.provider.slug === parsed.providerSlug);
      return link && parsed && isToolAllowed(link, link.provider.slug, parsed.name) ? { link, name: parsed.name } : null;
    }
    const allowed = links.filter((link) => isToolAllowed(link, link.provider.slug, exposed));
    for (const link of allowed) {
      const tools = await this.#providerTools(link.provider);
      if (tools.some((tool) => tool.name === exposed)) return { link, name: exposed };
    }
    // A single candidate gets the call even when its (possibly stale) cache lacks the tool.
    return allowed.length === 1 && allowed[0] ? { link: allowed[0], name: exposed } : null;
  }

  async callTool(name: string, args: Record<string, unknown> | undefined, signal: AbortSignal): Promise<CallToolResult> {
    const route = await this.#resolveTool(this.#context(), name);
    if (!route) throw new JsonRpcError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    const { provider } = route.link;
    try {
      const result = await this.#forward(
        provider,
        {
          method: 'tools/call',
          target: route.name,
          logged: true,
          inspect: (value: CallToolResult) => inspectToolResult(value, provider.failureRules),
        },
        (client, options) =>
          client.callTool({ name: route.name, arguments: args }, undefined, { ...options, signal }) as Promise<CallToolResult>,
      );
      return result;
    } catch (error) {
      // Upstream JSON-RPC errors (e.g. invalid arguments) pass through; everything else is a tool error.
      if (error instanceof JsonRpcError && error.fromUpstream) throw error;
      return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  }

  // -------------------------------------------------------------------------------- prompts & resources

  /** Lists from every provider that supports the capability, skipping providers known not to. */
  async #listFromProviders<T>(
    links: ProviderLink[],
    capability: 'prompts' | 'resources',
    method: string,
    fetch: (client: Client, options: RequestOptions) => Promise<T[]>,
  ): Promise<T[][]> {
    return Promise.all(
      links.map(async ({ provider }) => {
        const known = this.gateway.capabilitiesOf(provider.id);
        if (known && !known[capability]) return [];
        try {
          return await this.#forward(provider, { method }, (client, options) =>
            client.getServerCapabilities()?.[capability] ? fetch(client, options) : Promise.resolve([]),
          );
        } catch (error) {
          if (!(error instanceof NoKeyAvailableError)) {
            this.gateway.logger.warn(
              { sessionId: this.id, providerId: provider.id, method, error: safeErrorText(error) },
              'Could not list upstream items',
            );
          }
          return [];
        }
      }),
    );
  }

  async listPrompts(): Promise<Prompt[]> {
    const { endpoint, links } = this.#context();
    const lists = await this.#listFromProviders(links, 'prompts', 'prompts/list', listAllPrompts);
    this.#promptRoutes.clear();
    const prompts: Prompt[] = [];
    links.forEach((link, index) => {
      for (const prompt of lists[index] ?? []) {
        const name = exposedName(endpoint.toolPrefixMode, link.provider.slug, prompt.name);
        if (this.#promptRoutes.has(name)) continue;
        this.#promptRoutes.set(name, { providerId: link.provider.id, name: prompt.name });
        prompts.push({ ...prompt, name });
      }
    });
    return prompts;
  }

  #routePrompt(context: EndpointContext, exposed: string): { link: ProviderLink; name: string } | null {
    if (context.endpoint.toolPrefixMode === 'provider_slug') {
      const parsed = splitExposedName(exposed);
      const link = parsed && context.links.find((candidate) => candidate.provider.slug === parsed.providerSlug);
      return link && parsed ? { link, name: parsed.name } : null;
    }
    const route = this.#promptRoutes.get(exposed);
    const link = route && context.links.find((candidate) => candidate.provider.id === route.providerId);
    return link && route ? { link, name: route.name } : null;
  }

  async getPrompt(name: string, args: Record<string, string> | undefined, signal: AbortSignal) {
    let context = this.#context();
    let route = this.#routePrompt(context, name);
    if (!route) {
      await this.listPrompts();
      context = this.#context();
      route = this.#routePrompt(context, name);
    }
    if (!route) throw new JsonRpcError(ErrorCode.InvalidParams, `Unknown prompt: ${name}`);
    const upstreamName = route.name;
    return this.#forwardDownstream(route.link.provider, { method: 'prompts/get', target: upstreamName, logged: true }, (client, options) =>
      client.getPrompt({ name: upstreamName, arguments: args }, { ...options, signal }),
    );
  }

  async listResources(): Promise<Resource[]> {
    const { endpoint, links } = this.#context();
    const lists = await this.#listFromProviders(links, 'resources', 'resources/list', listAllResources);
    this.#resourceRoutes.clear();
    const resources: Resource[] = [];
    links.forEach((link, index) => {
      for (const resource of lists[index] ?? []) {
        // URIs stay untouched (they are opaque identifiers the client hands back); only names get the prefix.
        if (this.#resourceRoutes.has(resource.uri)) continue;
        this.#resourceRoutes.set(resource.uri, link.provider.id);
        resources.push({ ...resource, name: exposedName(endpoint.toolPrefixMode, link.provider.slug, resource.name) });
      }
    });
    return resources;
  }

  async listResourceTemplates(): Promise<ResourceTemplate[]> {
    const { endpoint, links } = this.#context();
    const lists = await this.#listFromProviders(links, 'resources', 'resources/templates/list', listAllResourceTemplates);
    this.#templateRoutes = [];
    const templates: ResourceTemplate[] = [];
    links.forEach((link, index) => {
      for (const template of lists[index] ?? []) {
        try {
          this.#templateRoutes.push({ template: new UriTemplate(template.uriTemplate), providerId: link.provider.id });
        } catch {
          continue;
        }
        templates.push({ ...template, name: exposedName(endpoint.toolPrefixMode, link.provider.slug, template.name) });
      }
    });
    return templates;
  }

  #routeResource(uri: string): string | null {
    return (
      this.#resourceRoutes.get(uri) ?? this.#templateRoutes.find(({ template }) => template.match(uri) !== null)?.providerId ?? null
    );
  }

  async readResource(uri: string, signal: AbortSignal) {
    let providerId = this.#routeResource(uri);
    if (!providerId) {
      await Promise.all([this.listResources(), this.listResourceTemplates()]);
      providerId = this.#routeResource(uri);
    }
    const { links } = this.#context();
    let link = providerId ? links.find((candidate) => candidate.provider.id === providerId) : undefined;
    if (!link) {
      const withResources = links.filter((candidate) => this.gateway.capabilitiesOf(candidate.provider.id)?.resources);
      if (withResources.length === 1) link = withResources[0];
    }
    if (!link) throw new JsonRpcError(RESOURCE_NOT_FOUND, 'Resource not found', { uri });
    return this.#forwardDownstream(link.provider, { method: 'resources/read', target: uri, logged: true }, (client, options) =>
      client.readResource({ uri }, { ...options, signal }),
    );
  }

  // ------------------------------------------------------------------------------------------ forwarding

  /** `#forward` with errors converted for the downstream client. */
  async #forwardDownstream<T>(
    provider: ProviderRow,
    options: ForwardOptions<T>,
    run: (client: Client, requestOptions: RequestOptions) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.#forward(provider, options, run);
    } catch (error) {
      if (error instanceof NoKeyAvailableError) throw new JsonRpcError(ErrorCode.InternalError, error.message);
      throw error;
    }
  }

  /**
   * Runs one upstream request with the session's key for the provider. A key failure (per the provider's
   * failureRules) puts the key into cooldown and, with failover enabled, rebinds the session to another key
   * and retries once per alternative key, up to MAX_ATTEMPTS in total. A lost upstream connection is
   * re-established once with the same key. Other errors propagate unchanged.
   */
  async #forward<T>(
    provider: ProviderRow,
    options: ForwardOptions<T>,
    run: (client: Client, requestOptions: RequestOptions) => Promise<T>,
  ): Promise<T> {
    const tried = new Set<string>();
    let reconnected = false;
    for (let attempt = 1; ; attempt += 1) {
      let bound: KeyWithProxy;
      try {
        bound = this.#boundKey(provider, tried);
      } catch (error) {
        if (error instanceof NoKeyAvailableError) this.#log(provider, null, options, performance.now(), error.message);
        throw error;
      }

      const started = performance.now();
      let connection: UpstreamConnection | undefined;
      let outcome: { ok: true; result: T } | { ok: false; error: unknown };
      try {
        connection = await this.#connection(provider, bound);
        outcome = { ok: true, result: await run(connection.client, { timeout: this.gateway.config.upstreamCallTimeoutMs }) };
      } catch (error) {
        outcome = { ok: false, error };
      }
      const secrets = connection?.secrets ?? this.gateway.secretsFor(bound);

      if (outcome.ok) {
        const result = redactValue(outcome.result, secrets);
        const verdict = options.inspect?.(result) ?? { error: null, keyFailure: false };
        const errorText = verdict.error === null ? null : redactSecrets(verdict.error, secrets);
        this.#log(provider, bound, options, started, errorText);
        if (verdict.keyFailure && this.#failover(provider, bound, errorText ?? 'Tool error', attempt, tried)) continue;
        return result;
      }

      const { error } = outcome;
      const verdict = classifyError(error, provider.failureRules);
      const message = safeUpstreamError(error, secrets);
      this.#log(provider, bound, options, started, message);
      if (connection && !reconnected && isConnectionLost(error)) {
        reconnected = true;
        this.#dropUpstream(provider.id);
        attempt -= 1;
        continue;
      }
      if (verdict.keyFailure && this.#failover(provider, bound, message, attempt, tried)) continue;
      throw downstreamError(error, message, secrets, provider.name);
    }
  }

  /** The session's key for the provider, binding one (per rotationStrategy) when there is none or it became unusable. */
  #boundKey(provider: ProviderRow, tried: ReadonlySet<string>): KeyWithProxy {
    const current = this.gateway.boundKey(this.id, provider.id);
    if (current && !tried.has(current.key.id) && isKeyUsable(current)) {
      if (!provider.failoverEnabled || !isCoolingDown(current.key, Date.now())) return current;
      // Cooled down after failing in another session: move on proactively when another key is free.
      const alternative = this.gateway.selectKey(provider, new Set([...tried, current.key.id]));
      if (!alternative) return current;
      this.gateway.bindKey(this.id, provider.id, alternative.key.id);
      return alternative;
    }
    const next = this.gateway.selectKey(provider, tried);
    if (!next) throw new NoKeyAvailableError(provider.name);
    this.gateway.bindKey(this.id, provider.id, next.key.id);
    return next;
  }

  /** Records the key failure; true when the session was rebound to another key and the call should be retried. */
  #failover(provider: ProviderRow, failed: KeyWithProxy, message: string, attempt: number, tried: Set<string>): boolean {
    this.gateway.recordKeyFailure(provider, failed.key.id, message);
    tried.add(failed.key.id);
    if (!provider.failoverEnabled || attempt >= MAX_ATTEMPTS) return false;
    const next = this.gateway.selectKey(provider, tried);
    if (!next) return false;
    this.gateway.bindKey(this.id, provider.id, next.key.id);
    this.gateway.logger.warn(
      { sessionId: this.id, providerId: provider.id, failedKeyId: failed.key.id, apiKeyId: next.key.id, attempt },
      'Key failure: session rebound to another key',
    );
    return true;
  }

  #log(provider: ProviderRow, bound: KeyWithProxy | null, options: LogOptions, started: number, error: string | null) {
    if (!options.logged) return;
    this.gateway.recordRequest({
      endpointId: this.endpointId,
      sessionId: this.id,
      providerId: provider.id,
      apiKeyId: bound?.key.id ?? null,
      proxyId: bound?.key.proxyId ?? null,
      toolName: options.target ?? null,
      method: options.method,
      status: error === null ? 'ok' : 'error',
      latencyMs: Math.round(performance.now() - started),
      errorMessage: error,
    });
  }

  /** Cached upstream client for (session, provider); rebuilt when the key, its proxy or the provider changed. */
  #connection(provider: ProviderRow, bound: KeyWithProxy): Promise<UpstreamConnection> {
    const fingerprint = connectionFingerprint(provider, bound);
    const existing = this.#upstreams.get(provider.id);
    if (existing && existing.fingerprint === fingerprint && !existing.connection?.closed) return existing.promise;
    if (existing) this.#dropUpstream(provider.id);

    const slot: UpstreamSlot = { fingerprint, promise: this.gateway.connectUpstream(provider, bound) };
    this.#upstreams.set(provider.id, slot);
    slot.promise.then(
      (connection) => {
        slot.connection = connection;
        // The session ended or moved on while this connection was being opened.
        if (this.#closed || this.#upstreams.get(provider.id) !== slot) void connection.close({ terminate: true });
      },
      () => {
        if (this.#upstreams.get(provider.id) === slot) this.#upstreams.delete(provider.id);
      },
    );
    return slot.promise;
  }

  #dropUpstream(providerId: string): void {
    const slot = this.#upstreams.get(providerId);
    if (!slot) return;
    this.#upstreams.delete(providerId);
    slot.promise.then((connection) => connection.close({ terminate: true })).catch(() => undefined);
  }
}
