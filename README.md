# MCPRoute

A self-hosted gateway for [Model Context Protocol](https://modelcontextprotocol.io) servers, similar to OmniRoute but for MCP.

- **Providers** are existing upstream MCP servers (for example [Exa](https://mcp.exa.ai)).
- Each provider can hold **many API keys**, and each key may use its own **outbound proxy**.
- **Endpoints** are MCP servers that MCPRoute exposes at `/mcp/{slug}`. Each one aggregates one or more providers.
- Keys rotate **per MCP session** (session affinity), not per tool call.

> **Status: step 1 of several.** This step adds the data model, the admin REST API, bulk import and the
> project scaffolding. The MCP proxy and rotation engine, the `/mcp/{slug}` routes, proxy health checks, tool
> fetching and the real admin UI come in later steps. The web app is a placeholder page for now.

## Tech stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js 20.19+ (Docker image: Node 24 LTS), TypeScript (strict) |
| Monorepo | pnpm workspaces: `apps/server`, `apps/web`, `packages/shared` |
| Backend | Fastify 5, pino logging, zod validation |
| Database | SQLite via better-sqlite3 + Drizzle ORM (SQL migrations in `apps/server/drizzle`) |
| Frontend | React 19, Vite 8, Tailwind CSS 4, shadcn/ui |
| Tests | Vitest |

## Project structure

```
.
├── apps/
│   ├── server/                 Fastify backend (REST API, serves the built UI)
│   │   ├── drizzle/            Generated SQL migrations
│   │   ├── src/
│   │   │   ├── db/             Drizzle schema, client, migration CLI
│   │   │   ├── lib/            Crypto (AES-256-GCM, hashing, masking), HTTP errors
│   │   │   ├── routes/         auth, providers, keys, proxies, endpoints, logs, sessions
│   │   │   ├── services/       Bulk import, proxy assignment, DTO mapping, lookups
│   │   │   ├── app.ts          Fastify app factory
│   │   │   ├── auth.ts         Admin session cookie + /api guard
│   │   │   ├── config.ts       Environment loading and validation
│   │   │   └── index.ts        Entry point (migrates, then listens)
│   │   └── test/               API integration tests
│   └── web/                    React + Vite + Tailwind + shadcn/ui (placeholder page)
├── packages/
│   └── shared/                 zod schemas, DTO types, constants, bulk-import parsers
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
Compose only passes `MASTER_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_TTL_MINUTES`, `LOG_LEVEL`,
`TRUST_PROXY` and `COOKIE_SECURE` into the container. `HOST`, the container port and `DATABASE_PATH` are fixed
by the image.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `MASTER_KEY` | *(required)* | 32 bytes as 64 hex chars or base64. Encrypts API keys at rest. Generate with `openssl rand -hex 32`. |
| `ADMIN_USERNAME` | `admin` | Admin login. |
| `ADMIN_PASSWORD` | *(required)* | Admin password, at least 8 characters. |
| `PORT` | `3000` | HTTP port. |
| `DATABASE_PATH` | `./data/mcproute.db` | SQLite file. Relative paths resolve against the `.env` directory, or the working directory when there is no `.env`. |
| `SESSION_TTL_MINUTES` | `60` | Idle lifetime of MCP sessions and their key bindings. |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` in Docker). |
| `LOG_LEVEL` | `info` | pino log level. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers (set when behind a reverse proxy). |
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
| `pnpm db:migrate` | Apply database migrations |
| `pnpm db:generate` | Generate a new SQL migration after changing `apps/server/src/db/schema.ts` |
| `pnpm test` | Run all Vitest suites |
| `pnpm typecheck` | Type-check every package |

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
| `GET` | `/api/logs` | Request logs: `page`, `pageSize`, `endpointId`, `providerId`, `apiKeyId`, `status`, `from`, `to` |
| `GET` | `/api/sessions` | Active MCP sessions with their bound keys (`page`, `pageSize`, `endpointId`) |
| `DELETE` | `/api/sessions/:id` | End a session and release its key bindings |
| `GET` | `/healthz` | Public health check |

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

## Security notes

- **API keys** are encrypted with AES-256-GCM using subkeys derived from `MASTER_KEY` (HKDF-SHA256). Duplicates
  are detected with a keyed HMAC fingerprint, so stored keys never need decrypting for that. Responses only
  contain masked keys.
- **Endpoint access tokens** (`mcpr_…`, 256 bits) are stored as SHA-256 hashes. The plaintext is returned only on
  create and regenerate.
- **Admin sessions** use a signed, `httpOnly`, `SameSite=Strict` cookie that lasts 24 hours. Credentials are
  compared in constant time.
- **Logs** never contain plaintext keys, proxy passwords, tokens or credentials. pino also redacts
  sensitive paths as a safety net.

## Testing

```bash
pnpm test        # shared parser tests, encryption tests and API integration tests
pnpm typecheck
```
