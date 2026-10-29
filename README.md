# MCPRoute

A self-hosted gateway for [Model Context Protocol](https://modelcontextprotocol.io) servers, similar to OmniRoute but for MCP.

- **Providers** are existing upstream MCP servers (for example [Exa](https://mcp.exa.ai)).
- Each provider can hold **many API keys**, and each key may use its own **outbound proxy**.
- **Endpoints** are MCP servers that MCPRoute exposes at `/mcp/{slug}`. Each one aggregates one or more providers.
- Keys rotate **per MCP session** (session affinity), not per tool call.

> **Status: step 3 of several.** Step 1 added the data model, the admin REST API and bulk import. Step 2 added
> the MCP gateway engine: `/mcp/{slug}` endpoints, per-session key affinity, per-key proxies, failover, request
> logging, tool caching, proxy health checks and stats. Step 3 adds the [admin web UI](#admin-ui).

## Tech stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js 20.19+ (Docker image: Node 24 LTS), TypeScript (strict) |
| Monorepo | pnpm workspaces: `apps/server`, `apps/web`, `packages/shared` |
| Backend | Fastify 5, pino logging, zod validation |
| MCP | Official TypeScript SDK (`@modelcontextprotocol/sdk` 1.32), undici + fetch-socks for per-key proxies |
| Database | SQLite via better-sqlite3 + Drizzle ORM (SQL migrations in `apps/server/drizzle`) |
| Frontend | React 19, Vite 8, Tailwind CSS 4, shadcn/ui, React Router 8, TanStack Query 5, React Hook Form + zod, Recharts, sonner |
| Tests | Vitest (Testing Library + jsdom for the UI) |
| Lint | oxlint |

## Project structure

```
.
├── apps/
│   ├── server/                 Fastify backend (REST API, serves the built UI)
│   │   ├── drizzle/            Generated SQL migrations
│   │   ├── src/
│   │   │   ├── db/             Drizzle schema, client, migration CLI
│   │   │   ├── gateway/        MCP gateway: /mcp routes, sessions, key selection, upstream clients,
│   │   │   │                   proxies, failover, background jobs
│   │   │   ├── lib/            Crypto (AES-256-GCM, hashing, masking), secret redaction, HTTP errors
│   │   │   ├── routes/         auth, providers, keys, proxies, endpoints, logs, sessions, stats
│   │   │   ├── services/       Bulk import, proxy assignment, key bookkeeping, DTO mapping, lookups
│   │   │   ├── app.ts          Fastify app factory
│   │   │   ├── auth.ts         Admin session cookie + /api guard
│   │   │   ├── config.ts       Environment loading and validation
│   │   │   └── index.ts        Entry point (migrates, then listens)
│   │   └── test/               API and gateway integration tests (mock upstream MCP server, test proxies)
│   └── web/                    Admin UI: React + Vite + Tailwind + shadcn/ui
│       └── src/
│           ├── components/     Layout (sidebar, theme), shared widgets, shadcn/ui components (ui/)
│           ├── lib/            API client, query client, formatters, client config snippets
│           ├── pages/          One folder or file per page (providers, endpoints, proxies, logs, ...)
│           ├── queries/        TanStack Query hooks per REST resource
│           └── test/           Vitest + Testing Library tests with a mocked API
├── packages/
│   └── shared/                 zod schemas, DTO types, constants, bulk-import parsers
├── scripts/
│   └── smoke-test.ts           Connects to an endpoint with the MCP SDK client, lists and calls tools
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Getting started (local, without Docker)

Prerequisites: Node.js 20.19 or newer, and pnpm 10. The repository pins pnpm 10.34.2 through `packageManager`,
so running `corepack enable` once is enough. better-sqlite3 ships prebuilt binaries for common platforms;
other platforms need a C++ toolchain.

```bash
pnpm install
cp .env.example .env
# Edit .env:
#   MASTER_KEY=<output of `openssl rand -hex 32`>
#   ADMIN_PASSWORD=<at least 8 characters>
pnpm db:migrate      # creates ./data/mcproute.db and applies migrations
pnpm dev             # API on http://localhost:3000, web UI on http://localhost:5173
```

During development the Vite dev server proxies `/api`, `/mcp` and `/healthz` to the API server. The server also
applies pending migrations on every start, so `pnpm db:migrate` is optional after the first run.

To run a production build locally (one process serves the API and the built UI on `PORT`):

```bash
pnpm build
pnpm start           # http://localhost:3000
```

## Running with Docker

```bash
cp .env.example .env   # set MASTER_KEY and ADMIN_PASSWORD
docker compose up -d --build
```

Open http://localhost:3000 (or the `PORT` from `.env`). The single container serves the API and the built web UI.
SQLite lives in the `mcproute-data` volume (`/data/mcproute.db`), and migrations run automatically on start.
Compose only passes `MASTER_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_TTL_MINUTES`,
`UPSTREAM_CONNECT_TIMEOUT_MS`, `UPSTREAM_CALL_TIMEOUT_MS`, `LOG_RETENTION_DAYS`, `PROXY_CHECK_URL`, `LOG_LEVEL`,
`TRUST_PROXY` and `COOKIE_SECURE` into the container. `HOST`, the container port and `DATABASE_PATH` are fixed
by the image. stdio providers run inside the container, so their command must exist there (`node`/`npx` do;
`uvx`, `python` or `docker` do not).

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `MASTER_KEY` | *(required)* | 32 bytes as 64 hex chars or base64. Encrypts API keys at rest. Generate with `openssl rand -hex 32`. |
| `ADMIN_USERNAME` | `admin` | Admin login. |
| `ADMIN_PASSWORD` | *(required)* | Admin password, at least 8 characters. |
| `PORT` | `3000` | HTTP port. |
| `DATABASE_PATH` | `./data/mcproute.db` | SQLite file. Relative paths resolve against the `.env` directory, or the working directory when there is no `.env`. |
| `SESSION_TTL_MINUTES` | `60` | Idle lifetime of MCP sessions and their key bindings. |
| `UPSTREAM_CONNECT_TIMEOUT_MS` | `15000` | Timeout for connecting to an upstream MCP server (proxy/TCP connect and `initialize`) and for proxy health checks. |
| `UPSTREAM_CALL_TIMEOUT_MS` | `120000` | Timeout for one forwarded upstream request (`tools/call`, `tools/list`, ...). |
| `LOG_RETENTION_DAYS` | `30` | Request logs older than this are deleted (checked hourly). |
| `PROXY_CHECK_URL` | `https://api.ipify.org?format=json` | Fetched through a proxy by the health check; must return `{"ip": "..."}` or a bare IP. |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` in Docker). |
| `LOG_LEVEL` | `info` | pino log level. |
| `TRUST_PROXY` | `true` | Trust `X-Forwarded-*` headers. MCPRoute is meant to run behind a reverse proxy; set `false` when it is exposed directly. |
| `COOKIE_SECURE` | `auto` | Secure flag of the session cookie: `auto`, `true` or `false`. |
| `WEB_DIST_DIR` | `apps/web/dist` | Directory of the built web UI. |

Changing `ADMIN_USERNAME`, `ADMIN_PASSWORD` or `MASTER_KEY` signs out existing admin sessions. Changing
`MASTER_KEY` also makes stored API keys undecryptable; key rotation is not supported yet.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | API server (tsx watch) and Vite dev server in parallel |
| `pnpm build` | Build the web UI (`apps/web/dist`) and bundle the server (`apps/server/dist`) |
| `pnpm start` | Start the built server |
| `pnpm smoke-test <url> <token> [tool] [json-args]` | Connect to an endpoint with the MCP SDK client, list tools, optionally call one (`--sse`, `--query-token`) |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm db:generate` | Generate a new SQL migration after changing `apps/server/src/db/schema.ts` |
| `pnpm test` | Run all Vitest suites |
| `pnpm typecheck` | Type-check every package |
| `pnpm lint` | Lint the repository with oxlint (`.oxlintrc.json`) |

## Admin UI

The web UI is served by the same Fastify process, on the same origin as the API: open http://localhost:3000 (or
http://localhost:5173 with `pnpm dev`) and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Any `401` from the
API, for example once the 24-hour admin session expires, returns to the login page. *Log out* is in the user menu.

| Page | What you can do |
| --- | --- |
| Dashboard | Provider, key, proxy and session counts, requests and error rate of the last 24 hours, requests and errors per hour |
| Providers | Create and edit providers: the form follows the transport and auth mode; presets for Exa, Tavily, Firecrawl and Brave Search; rotation, failover, cooldown and failure rules |
| Provider detail | **API keys**: status, proxy, usage, errors, sessions and last error; enable, disable, edit, test, reset cooldown and delete, per key or in bulk; add one key or paste many (`key`, `key\|proxyUrl`, `key\|proxyUrl\|label`); assign proxies. **Tools**: the cached tool list with input schemas, refresh |
| Proxies | Import a list, check one or all (with progress), see latency, exit IP and key count, enable, disable, edit and delete |
| Endpoints | Create and edit endpoints, link providers with per-provider tool allow and deny lists, regenerate the token. The detail page has copy-ready URLs and configurations for Claude Desktop (via `mcp-remote`), Cursor, VS Code and any Streamable HTTP client |
| Sessions | Active MCP sessions with the key bound for each provider; terminate a session |
| Logs | Filter by endpoint, provider, key, status and date range, auto-refresh every 5 seconds, expand a row for the full error |

- The endpoint access token is shown **once**, in a dialog, right after creating the endpoint or regenerating its
  token. Elsewhere the client snippets use the placeholder `<YOUR_TOKEN>`.
- Full API keys and proxy passwords are never displayed: the API only returns masked values.
- Light, dark or system theme (system by default); the layout adapts to phones.
- The provider presets were checked against the providers' documentation in October 2026. Firecrawl's hosted
  server now takes the key as a bearer token, so its preset uses `https://mcp.firecrawl.dev/v2/mcp` with
  `Authorization: Bearer {{API_KEY}}` instead of a key in the URL path.

| | |
| --- | --- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![API keys of a provider](docs/screenshots/provider-keys.png) |
| ![Connect section of an endpoint](docs/screenshots/endpoint-connect.png) | ![Logs](docs/screenshots/logs.png) |

More screenshots are in [`docs/screenshots`](docs/screenshots).

## Admin REST API

Every route under `/api` requires an admin session, except `POST /api/auth/login`. Bodies are JSON and are
validated with the zod schemas in `packages/shared`. Errors look like
`{ "statusCode": 400, "error": "Bad Request", "message": "Validation failed", "issues": [{ "path": "url", "message": "..." }] }`.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/auth/login` | `{ username, password }`. Sets a signed httpOnly session cookie (24 h) |
| `POST` | `/api/auth/logout` | Clears the session cookie |
| `GET` | `/api/auth/me` | Current admin session |
| `GET` / `POST` | `/api/providers` | List (with key stats) / create provider |
| `GET` / `PATCH` / `DELETE` | `/api/providers/:id` | Read / update / delete provider (deletes its keys) |
| `GET` / `POST` | `/api/providers/:id/keys` | List / add keys (always masked, e.g. `sk-****abcd`) |
| `POST` | `/api/providers/:id/keys/bulk` | Bulk import keys → `{ created, skipped, errors[], proxiesCreated }` |
| `POST` | `/api/providers/:id/keys/assign-proxies` | Auto-assign proxies to keys → `{ assigned, unassigned }` |
| `GET` / `PATCH` / `DELETE` | `/api/keys/:id` | Read / update (key, label, proxy, enabled, weight, status) / delete key |
| `GET` / `POST` | `/api/proxies` | List (with key counts) / create proxy |
| `POST` | `/api/proxies/bulk` | Bulk import proxies → `{ created, skipped, errors[] }` |
| `GET` / `PATCH` / `DELETE` | `/api/proxies/:id` | Read / update / delete proxy (its keys become unassigned) |
| `GET` / `POST` | `/api/endpoints` | List / create endpoint (the access token is returned once) |
| `GET` / `PATCH` / `DELETE` | `/api/endpoints/:id` | Read / update / delete endpoint |
| `POST` | `/api/endpoints/:id/regenerate-token` | New access token (returned once) |
| `PUT` | `/api/endpoints/:id/providers` | Replace linked providers and their tool filters |
| `POST` | `/api/providers/:id/refresh-tools` | Fetch `tools/list` with one available key and store it as the tool cache → `{ tools, toolsFetchedAt }` (409 without a usable key, 502 on upstream errors) |
| `POST` | `/api/keys/:id/test` | Connect upstream with this key and its proxy, run `tools/list` → `{ ok, latencyMs, toolCount, error }` |
| `POST` | `/api/proxies/:id/check` | Fetch `PROXY_CHECK_URL` through the proxy, store the health (status, latency, exit IP, error) → `{ proxyId, ok, status, exitIp, latencyMs, error, checkedAt }` |
| `POST` | `/api/proxies/check-all` | Check every proxy (10 at a time) → `{ total, ok, failed, results[] }` |
| `GET` | `/api/logs` | Request logs: `page`, `pageSize`, `endpointId`, `providerId`, `apiKeyId`, `status`, `from`, `to` |
| `GET` | `/api/sessions` | Active MCP sessions with their bound keys (`page`, `pageSize`, `endpointId`) |
| `DELETE` | `/api/sessions/:id` | End a session: release its key bindings and close its live connections |
| `GET` | `/api/stats/overview` | Providers, keys by status, proxies by status, active sessions, requests and error rate (last 24 h) |
| `GET` | `/api/stats/timeseries` | Requests and errors per hour, oldest first: `?hours=` (1–168, default 24) → `{ bucketMinutes, buckets: [{ start, total, ok, error }] }`. Buckets are aligned to the hour; the last one is the current hour |
| `GET` | `/healthz` | Public health check |

Proxy checks only update the proxy's health; they never disable proxies or keys. Proxies expose the result of
the last check as `status`, `lastCheckedAt`, `lastLatencyMs`, `lastExitIp` (the public IP seen through the proxy;
`null` when the check failed) and `lastError`; changing a proxy's URL resets them. The key test and tool refresh
use the stored key without changing its counters or cooldown.

### Example

```bash
API=http://localhost:3000/api
curl -c cookies.txt -H 'content-type: application/json' \
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' $API/auth/login

# Provider: authMode is inferred as "url_placeholder" because the URL contains {{API_KEY}}
curl -b cookies.txt -H 'content-type: application/json' $API/providers -d '{
  "name": "Exa", "transport": "streamable_http",
  "url": "https://mcp.exa.ai/mcp?exaApiKey={{API_KEY}}"
}'

# Bulk import keys (replace <PROVIDER_ID>)
curl -b cookies.txt -H 'content-type: application/json' $API/providers/<PROVIDER_ID>/keys/bulk -d '{
  "text": "key-1\nkey-2|1.2.3.4:8080:user:pass\nkey-3|socks5://u:p@5.6.7.8:1080|Backup",
  "defaultProxyScheme": "http"
}'

# Endpoint: copy the accessToken from the response, it is only shown once
curl -b cookies.txt -H 'content-type: application/json' $API/endpoints -d '{"name": "Research"}'
curl -b cookies.txt -X PUT -H 'content-type: application/json' $API/endpoints/<ENDPOINT_ID>/providers -d '{
  "providers": [{ "providerId": "<PROVIDER_ID>", "toolFilterMode": "allowlist", "toolNames": ["web_search_exa"] }]
}'
```

### Providers

- `transport` is `streamable_http`, `sse` or `stdio`.
- HTTP transports need a `url`. stdio needs `command` (plus optional `args` and `env`).
- `authMode` decides how the bound key reaches the upstream server:
  - `header`: `authHeaderName: authValueTemplate`, default `Authorization: Bearer {{API_KEY}}`.
  - `query`: the key goes in the `authQueryParam` query parameter.
  - `url_placeholder`: `{{API_KEY}}` inside `url`.
  - `env` (stdio only): `{{API_KEY}}` inside `env` values or `args`.
- `rotationStrategy` (`round_robin`, `random` or `least_used`) applies when a new session picks a key.
  `failoverEnabled` rebinds a session when its key fails, and `cooldownSeconds` sets how long a failed key rests.
- `failureRules` lists the conditions that count as a key failure. The default is
  `{ "httpStatuses": [401, 402, 403, 429], "messagePatterns": ["rate limit|quota|credit|insufficient"] }`.
  Patterns are case-insensitive regular expressions.

### Bulk import formats

Blank lines and lines starting with `#` are ignored. Each import is capped at 10,000 lines. Error messages
never echo keys or proxy passwords.

**Keys** (`POST /api/providers/:id/keys/bulk`, body `{ text, defaultProxyScheme?: "http" | "socks5" }`):

```
key
key|proxyUrl
key|proxyUrl|label
key||label
```

Inline proxies accept any proxy format below. They are upserted into the proxy pool and de-duplicated by
canonical URL. Keys that already exist for the provider, or that repeat within the input, count as `skipped`.

**Proxies** (`POST /api/proxies/bulk`, body `{ text, defaultScheme?: "http" | "socks5" }`):

```
scheme://user:pass@host:port     # http, https, socks5, socks5h
user:pass@host:port              # uses defaultScheme
host:port                        # uses defaultScheme
host:port:user:pass              # uses defaultScheme; the password may contain ':' and '@'
```

Proxies are stored in canonical form, with a lowercase scheme and host, an explicit port and normalized
credential encoding. Duplicates in any notation are skipped. API responses mask passwords
(`socks5://user:****@host:1080`).

**Assigning proxies** (`POST /api/providers/:id/keys/assign-proxies`,
body `{ mode, proxyIds?, onlyUnassigned }`). The pool is either the given proxy IDs or all enabled proxies;
disabled proxies are never assigned.

- `round_robin`: cycles through the pool. With `onlyUnassigned`, it balances around existing assignments.
- `random`: picks a random proxy for each key.
- `one_to_one`: each proxy serves at most one of the provider's keys. Keys left over when proxies run out
  stay unassigned and are reported as `unassigned`.

## MCP endpoints

Every enabled endpoint is a full MCP server at `/mcp/{slug}` that aggregates its linked, enabled providers.

| Method | Path | Transport |
| --- | --- | --- |
| `POST` / `GET` / `DELETE` | `/mcp/{slug}` | Streamable HTTP (current spec). `Mcp-Session-Id` is issued on `initialize`. |
| `GET` | `/mcp/{slug}/sse` | Legacy HTTP+SSE stream, only when the endpoint has `enableSse: true` |
| `POST` | `/mcp/{slug}/messages?sessionId=…` | Legacy HTTP+SSE messages, only when `enableSse: true` |

**Authentication.** Send the endpoint's access token as `Authorization: Bearer <token>`, or as `?token=<token>`
for clients that cannot set headers. Tokens are compared by SHA-256 hash in constant time. Unknown or disabled
endpoints answer `404`, a missing or wrong token `401`. With `?token=` on the legacy SSE stream, the message URL
announced to the client carries the token too. Query tokens are redacted from request logs.

### Sessions and key affinity

- MCPRoute generates the session id, stores it in `sessions` and keeps it alive while requests arrive. Sessions
  idle for `SESSION_TTL_MINUTES` are expired by a background job, which also closes their upstream connections
  and releases their keys. `DELETE /mcp/{slug}` (client) and `DELETE /api/sessions/:id` (admin) end a session
  immediately.
- The first request in a session that needs a provider binds **one key** for that provider, chosen by the
  provider's `rotationStrategy`. All later calls for that provider in the session use the same key and the same
  upstream client. Bindings live in `session_bindings`.
  - `round_robin`: smooth weighted round robin (a key with `weight: 3` is picked three times as often).
  - `random`: weighted random.
  - `least_used`: fewest bound sessions per unit of weight, then fewest calls.
- Keys that are disabled, in cooldown, or assigned to a disabled proxy are skipped (traffic never falls back to a
  direct connection). Cooldowns end automatically once `cooldownUntil` has passed.
- Upstream clients are opened lazily per (session, provider) and cached in memory; upstream sessions are separate
  and internal. After a restart, clients keep their session id: the session is rebuilt from the database with the
  same key bindings and reconnects upstream on its next call. Legacy SSE sessions end with their stream.
- If no key is available, the call returns an MCP tool error (`isError: true`) that says so.

### Upstream connections and proxies

The key is placed according to the provider's `authMode` (header template, query parameter, `{{API_KEY}}` in the
URL, or `{{API_KEY}}` in stdio env values and args). For `streamable_http` and `sse` providers each connection
uses an undici dispatcher for the key's proxy: an HTTP CONNECT tunnel for `http`/`https` proxies and
[fetch-socks](https://github.com/Kaciras/fetch-socks) for `socks5`/`socks5h` (with authentication; the proxy
resolves hostnames in both cases). Keys without a proxy connect directly.

stdio providers are spawned with a minimal environment (`PATH`, `HOME`, …) plus the provider's `env`. When the
key has a proxy, `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` (and lowercase variants) are set, plus
`NODE_USE_ENV_PROXY=1` for http(s) proxies. **This is best effort:** only programs that honour these variables
are proxied, and many ignore them (Node.js before v24 ignores them entirely, and few programs support SOCKS this
way).

### Tools, prompts and resources

- `tools/list` merges the tools of all linked providers. Each link's `toolFilterMode` applies (`allowlist` /
  `denylist` with `toolNames`, by upstream name or prefixed name). With `toolPrefixMode: "provider_slug"` tools
  are exposed as `{providerSlug}__{toolName}` and the prefix is stripped when routing. Without prefixes, the first
  provider (by name) wins when two expose the same tool name.
- `tools/list` uses the provider's `cachedTools` without connecting upstream. A cache older than 24 hours is
  refreshed in the background; a provider without a cache is listed through the session's key and cached.
- `prompts/*` and `resources/*` (`resources/list`, `resources/templates/list`, `resources/read`) are forwarded to
  providers that announce the capability. Prompt names get the same prefix; resources keep their URIs (they are
  opaque identifiers) and only their names are prefixed. Resource subscriptions, completions and upstream
  notifications (`list_changed`, progress, logging) are not forwarded.

### Failover and cooldown

A call fails because of its key when the upstream transport returns one of the provider's
`failureRules.httpStatuses`, or when the error message (or the text of an `isError` tool result) matches one of
`failureRules.messagePatterns`. Then MCPRoute increments the key's `errorCount`, stores `lastError`, puts the key
into cooldown for `cooldownSeconds` and, if `failoverEnabled`, binds the session to another key, reconnects and
retries the same call once per alternative key (at most 3 attempts in total). Other errors — invalid arguments,
ordinary tool errors — are returned as they are, without failover. JSON-RPC errors from the upstream keep their
code and message.

> **Note:** failover moves the session to a different key, and therefore to a new upstream session. Upstream
> state tied to the old key (async task or job IDs, server-side caches, conversation state) is lost.

### Logging and stats

Each `tools/call` attempt (also `prompts/get` and `resources/read`) writes one `request_logs` row with endpoint,
session, provider, key, proxy, tool, status, latency and error; failover attempts get their own rows. Keys track
`usageCount`, `lastUsedAt` and `activeSessions` (sessions currently bound). Logs older than
`LOG_RETENTION_DAYS` are deleted hourly. The upstream API key (verbatim or URL-encoded) and proxy passwords are
masked in error messages and in upstream results before they reach the logs, the admin API or MCP clients.

## Connecting MCP clients

Create an endpoint, link providers, and copy the access token (it is shown once; regenerate it with
`POST /api/endpoints/:id/regenerate-token`). The endpoint URL is `https://<your-host>/mcp/<slug>`.

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "mcproute": {
      "url": "https://mcp.example.com/mcp/research",
      "headers": { "Authorization": "Bearer ${env:MCPROUTE_TOKEN}" }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`). Its custom connectors have no field for a bearer token, so use
the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge (needs Node.js):

```json
{
  "mcpServers": {
    "mcproute": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.example.com/mcp/research", "--header", "Authorization:${MCPROUTE_AUTH}"],
      "env": { "MCPROUTE_AUTH": "Bearer mcpr_your_token" }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add --transport http mcproute https://mcp.example.com/mcp/research \
  --header "Authorization: Bearer mcpr_your_token"
```

Clients that cannot send headers can use `https://mcp.example.com/mcp/research?token=mcpr_your_token`. Clients that
only speak the legacy SSE transport use `https://mcp.example.com/mcp/research/sse` (enable `enableSse` on the
endpoint first).

**Smoke test** from a checkout:

```bash
pnpm smoke-test https://mcp.example.com/mcp/research mcpr_your_token                     # list tools
pnpm smoke-test https://mcp.example.com/mcp/research mcpr_your_token web_search_exa '{"query":"MCP"}'
pnpm smoke-test https://mcp.example.com/mcp/research mcpr_your_token --sse --query-token
```

`MCPROUTE_URL` and `MCPROUTE_TOKEN` can replace the first two arguments. The exit code is non-zero when
connecting fails or the tool returns an error.

## Running behind a reverse proxy (Caddy)

MCPRoute trusts `X-Forwarded-*` by default (`TRUST_PROXY=true`). MCP responses are streamed (SSE): MCPRoute sends
`Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, flushes every event immediately, and writes a
keep-alive comment every 25 seconds on idle streams so proxies do not cut them. A minimal Caddyfile:

```caddyfile
mcp.example.com {
	reverse_proxy mcproute:3000 {
		# Stream responses immediately (Caddy also does this for text/event-stream by default).
		flush_interval -1
	}
}
```

Do not enable response compression (`encode`) for `/mcp/*`. With Compose, put Caddy on the same network and drop
the `ports` mapping if MCPRoute should only be reachable through Caddy.

## Security notes

- **API keys** are encrypted with AES-256-GCM using subkeys derived from `MASTER_KEY` (HKDF-SHA256). Duplicates
  are detected with a keyed HMAC fingerprint, so stored keys never need decrypting for that. Responses only
  contain masked keys.
- **Endpoint access tokens** (`mcpr_…`, 256 bits) are stored as SHA-256 hashes. The plaintext is returned only on
  create and regenerate.
- **Admin sessions** use a signed, `httpOnly`, `SameSite=Strict` cookie that lasts 24 hours. Credentials are
  compared in constant time.
- **Logs** never contain plaintext keys, proxy passwords, tokens or credentials. pino also redacts
  sensitive paths as a safety net, and `?token=` is stripped from logged URLs.
- **Upstream keys stay private.** MCP clients only ever see the endpoint token. Keys are decrypted just before
  connecting upstream, and are masked in upstream errors and results forwarded to clients.
- **stdio providers** do not inherit the server's environment (so `MASTER_KEY` and `ADMIN_PASSWORD` are not
  visible to them), only a minimal set of variables plus the provider's `env`.

## Testing

```bash
pnpm test        # shared parser tests, unit tests, API and gateway integration tests, web UI tests
pnpm typecheck
pnpm lint
```

The gateway tests start an in-process upstream MCP server (Streamable HTTP and legacy SSE, built with the SDK), a
stdio MCP server, and local HTTP CONNECT and SOCKS5 proxies. They cover session affinity, rotation, restoring
sessions after a restart, idle expiry, tool prefixing and filters, the tool cache, prompts and resources, failover
on HTTP 429 and on quota errors in tool results, per-key proxies, token authentication (header and query), the
legacy SSE transport, keep-alive pings, and the new admin routes.

The web UI tests (`apps/web/src/test`) render the whole app against a mocked admin API with Vitest, Testing
Library and jsdom. They cover signing in and the redirect on `401`, creating providers from presets (including
validation with the shared schemas), and bulk key import.
