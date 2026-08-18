# Firewall Orchestrator API

A Node.js and TypeScript orchestrator API for managing firewall rules — IP addresses, domains,
and ports — organized into blacklist and whitelist lists. The project is structured with
Hexagonal (Ports & Adapters) Architecture and is being extended with PostgreSQL persistence via
Drizzle ORM.

## Current features

- Add IP, domain, and port rules, each tagged as `blacklist` or `whitelist`.
- Retrieve all rules, optionally filtered by type (`ip`, `domain`, or `port`).
- Update the `active` status of one or more rules without deleting them.
- Delete rules by ID.
- Full input validation (IPv4 format, domain format, port range, mode, non-empty arrays, ID
  types) with a standardized `{ status: "error", code, message }` error shape and correct HTTP
  status codes (`400` for validation errors, `404` for missing rules).
- Request logging for every incoming HTTP request.
- Atomic delete and status-update behavior: if a request's ID list contains even one ID that
  doesn't exist, **nothing is removed or changed** — the whole batch is rejected with `404`, not
  partially applied.
- Structured, environment-aware logging (console in development, file in production) via a
  Winston-backed Singleton logger.
- Centralized, fail-fast environment configuration validated with Zod.

## API endpoints

All routes are mounted under `/api/firewall`. Request/response shapes below were verified
directly against the controller (`src/adapters/inbound/http/controllers/firewallController.ts`)
and the validators (`src/application/validation/ruleValidation.ts`).

### `POST /api/firewall/ips`

Adds one or more IPv4 rules.

```json
{ "values": ["1.2.3.4", "5.6.7.8"], "mode": "blacklist" }
```

Success — `201`:

```json
{
  "type": "ip",
  "mode": "blacklist",
  "values": [
    { "id": 1, "value": "1.2.3.4", "active": true },
    { "id": 2, "value": "5.6.7.8", "active": true }
  ],
  "status": "success"
}
```

### `POST /api/firewall/domains`

Same shape as above, with domain values (no protocol, path, or port allowed):

```json
{ "values": ["example.com"], "mode": "whitelist" }
```

### `POST /api/firewall/ports`

Same shape, with integer port numbers (1–65535):

```json
{ "values": [8080, 8443], "mode": "blacklist" }
```

### `GET /api/firewall/rules`

Optional query parameter: `?type=ip` | `?type=domain` | `?type=port`.

Without a filter — `200`, all three types grouped by mode:

```json
{
  "ips": { "blacklist": [], "whitelist": [] },
  "domains": { "blacklist": [], "whitelist": [] },
  "ports": { "blacklist": [], "whitelist": [] }
}
```

With `?type=ip` — `200`, only the matching key is present:

```json
{ "ips": { "blacklist": [{ "id": 1, "type": "ip", "mode": "blacklist", "value": "1.2.3.4", "active": true }], "whitelist": [] } }
```

### `DELETE /api/firewall/rules`

```json
{ "ids": [1, 2] }
```

Success — `200`:

```json
{ "removed": [{ "id": 1, "type": "ip", "mode": "blacklist", "value": "1.2.3.4", "active": true }], "status": "success" }
```

If any ID in the list doesn't exist, the response is `404` with code `RULE_NOT_FOUND` and
**no rule is deleted**, including the valid ones in the same request.

### `PATCH /api/firewall/rules/status`

```json
{ "ids": [1, 2], "active": false }
```

Success — `200`:

```json
{ "updated": [{ "id": 1, "type": "ip", "mode": "blacklist", "value": "1.2.3.4", "active": false }], "status": "success" }
```

Same atomic guarantee as `DELETE`: any missing ID → `404 RULE_NOT_FOUND`, nothing changed.

### Common validation errors

| Code | Meaning |
|---|---|
| `INVALID_IP` / `INVALID_DOMAIN` / `INVALID_PORT` | A value doesn't match the required format/range for its type. |
| `INVALID_MODE` | `mode` is not exactly `"blacklist"` or `"whitelist"`. |
| `INVALID_VALUES` | `values` is missing, not an array, or empty. |
| `INVALID_IDS` | `ids` is missing, not an array, empty, or contains a non-integer. |
| `INVALID_ACTIVE` | `active` is not a boolean. |
| `INVALID_TYPE` | The `?type=` query value is not `ip`, `domain`, or `port`. |
| `RULE_NOT_FOUND` (`404`) | One or more requested IDs don't exist. |
| `INVALID_JSON` (`400`) | The request body isn't valid JSON. |

## Architecture

The project follows Hexagonal Architecture, with dependencies pointing inward:

- **`src/domain/entities`** — the core `FirewallRule` model (`RuleType`, `RuleMode`, `RuleValue`),
  with no dependency on any framework or storage technology.
- **`src/application`** — the use cases (`AddRulesUseCase`, `GetRulesUseCase`,
  `RemoveRulesUseCase`, `UpdateRuleStatusUseCase`), input validation, and typed application
  errors. Depends only on `domain`.
- **`src/application/ports/RuleRepository.ts`** — the port: an interface describing what storage
  must be able to do (`add`, `getAll`, `removeByIds`, `updateStatus`), without saying how. Every
  use case depends on this interface, never on a concrete repository class — this is what lets
  the storage implementation be swapped without touching any use case, controller, or route.
- **`src/adapters/inbound/http`** — the Express adapter: `app.ts` (middleware/route wiring),
  `controllers/firewallController.ts` (translates HTTP requests into use-case calls), and
  `middleware/` (request logging, error handling).
- **`src/adapters/outbound/persistence/memory`** — `InMemoryRuleRepository`, a `RuleRepository`
  implementation backed by a plain in-memory array.
- **`src/adapters/outbound/persistence/postgres`** — the PostgreSQL/Drizzle adapter: the Drizzle
  schema and the database connection manager (see below). This does **not** yet include a
  `RuleRepository` implementation — see "Current persistence status."
- **`src/main`** — the composition root: `env.ts` (configuration), `Logger.ts` (Winston
  Singleton), and `server.ts` (constructs the repository, builds the Express app, starts
  listening).
- **`tests/`** — `unit/` (mirrors `src/`'s structure) and `integration/http/` (full HTTP-layer
  tests via Supertest).
- **`drizzle/`** — Drizzle-generated SQL migrations and their tracking metadata (see "Database
  structure" below).

### Request flow

```
Client
  ↓
Express Route (app.ts)
  ↓
Controller (firewallController.ts)
  ↓
Use Case (application/use-cases/*)
  ↓
Validation (ruleValidation.ts)
  ↓
Repository (RuleRepository port → a concrete adapter)
  ↓
JSON Response
```

Today, the repository at the bottom of that chain is always `InMemoryRuleRepository` — see the
next section.

## Current persistence status

**PostgreSQL and Drizzle ORM infrastructure has been added to this repository, but the running
API does not use it yet.** Two separate things are true at the same time:

- ✅ A Drizzle schema (`firewall_rules` table), an initial migration, and a
  `PostgresConnection` Singleton with Stop-and-Wait retry logic all exist and are unit-tested
  (see below).
- ❌ There is **no PostgreSQL-backed implementation of `RuleRepository` yet**, and
  `src/main/server.ts` still constructs and uses `InMemoryRuleRepository` exclusively. No HTTP
  request currently reaches PostgreSQL. Rule data is **not** persisted across server restarts.

Implementing the PostgreSQL repository, the row↔domain mapping, and wiring it into the server are
tracked as upcoming work — see "Current limitations / roadmap."

## PostgreSQL and Drizzle setup

1. **Install PostgreSQL** locally (or have access to a running instance).
2. **Create the database once**, e.g. via `psql` or a GUI tool:
   ```sql
   CREATE DATABASE firewall_dev;
   ```
3. **DBeaver** (optional) — a free graphical client that can connect to the same PostgreSQL
   instance for browsing tables and running ad-hoc queries; not required to run the project.
4. **Configure `.env`** — copy `.env.example` to `.env` and fill in your local database
   credentials (see "Environment variables" below). `.env` is git-ignored and must never be
   committed.
5. **Schema and migrations** — the Drizzle schema lives at
   `src/adapters/outbound/persistence/postgres/schema.ts`; generated SQL migrations and their
   tracking metadata live under `drizzle/`.
6. **Generate a migration** after changing the schema:
   ```bash
   npm run db:generate
   ```
7. **Apply migrations** to your database:
   ```bash
   npm run db:migrate
   ```
   `drizzle.config.ts` sets `ssl: false` for the local database connection, since a typical local
   PostgreSQL install does not have SSL enabled.

## Environment variables

All variables are validated at startup by `src/main/env.ts` (via Zod); the process fails fast
with a descriptive error if any are missing or invalid. See `.env.example` for the full template
— **never copy a real password into source control or documentation.**

| Variable | Purpose |
|---|---|
| `ENV` | `dev` or `production`. Controls environment-specific behavior such as log level/output. |
| `PORT` | The HTTP port the server listens on (1–65535). |
| `DB_CONNECTION_INTERVAL` | Milliseconds to wait between PostgreSQL connection retry attempts. |
| `DB_HOST` | PostgreSQL host. |
| `DB_PORT` | PostgreSQL port (1–65535). |
| `DB_USER` | PostgreSQL username. |
| `DB_PASSWORD` | PostgreSQL password. |
| `DB_NAME` | PostgreSQL database name. |

## Database structure

The `firewall_rules` table (defined in `schema.ts`, applied via
`drizzle/0000_pretty_madripoor.sql`):

| Column | Type | Constraints |
|---|---|---|
| `id` | `serial` | Primary key |
| `type` | `text` | `NOT NULL`; `CHECK` restricted to `'ip'`, `'domain'`, `'port'` |
| `mode` | `text` | `NOT NULL`; `CHECK` restricted to `'blacklist'`, `'whitelist'` |
| `value` | `text` | `NOT NULL` |
| `active` | `boolean` | `NOT NULL`, defaults to `true` |

Drizzle tracks which migrations have already been applied to a given database using its own
migrations-history table (created automatically the first time `npm run db:migrate` runs
successfully), so re-running migrations does not attempt to recreate tables that already exist.

## Database connection management

`src/adapters/outbound/persistence/postgres/connection.ts` implements `PostgresConnection`:

- **Singleton** — `PostgresConnection.getInstance()` always returns the same instance; only one
  `pg.Pool` is ever created and reused.
- **Stop-and-Wait retry** — on connection failure, it waits a fixed interval (from
  `DB_CONNECTION_INTERVAL`) before trying again, one attempt at a time, up to a bounded
  `MAX_CONNECTION_ATTEMPTS` (currently 5).
- **Concurrent-call protection** — if `connect()` is called again while a connection attempt is
  already in progress, the second call shares the same in-flight attempt instead of starting a
  parallel one.
- **Shutdown** — a `shutdown()` method closes the pool and resets internal state; it is safe to
  call more than once.

**This connection manager is not yet called anywhere in `server.ts`.** It is fully implemented
and unit-tested in isolation, but the running server does not currently establish a PostgreSQL
connection at startup.

## Installation and running

PostgreSQL must already be running and `.env` must be configured before starting the server
(the server itself does not yet depend on a database connection — see above — but `npm run
db:migrate` does).

```bash
npm install
npm run db:migrate
npm run dev
```

- `npm run dev` — start the API in watch mode.
- `npm run build` — compile TypeScript to `dist/`.
- `npm start` — run the compiled server (`node dist/main/server.js`).
- `npm run lint` — type-check without emitting.

## Manual API testing

With the server running (default `http://localhost:3000`):

```bash
# Get all rules
curl http://localhost:3000/api/firewall/rules

# Add an IP rule
curl -X POST http://localhost:3000/api/firewall/ips \
  -H "Content-Type: application/json" \
  -d '{"values":["1.2.3.4"],"mode":"blacklist"}'

# Add a domain rule
curl -X POST http://localhost:3000/api/firewall/domains \
  -H "Content-Type: application/json" \
  -d '{"values":["example.com"],"mode":"whitelist"}'

# Add a port rule
curl -X POST http://localhost:3000/api/firewall/ports \
  -H "Content-Type: application/json" \
  -d '{"values":[8080],"mode":"blacklist"}'

# Deactivate rule 1 without deleting it
curl -X PATCH http://localhost:3000/api/firewall/rules/status \
  -H "Content-Type: application/json" \
  -d '{"ids":[1],"active":false}'

# Delete rule 1
curl -X DELETE http://localhost:3000/api/firewall/rules \
  -H "Content-Type: application/json" \
  -d '{"ids":[1]}'
```

PowerShell equivalent (avoids `curl.exe`'s quote-escaping issues on Windows):

```powershell
$body = @{ values = @("1.2.3.4"); mode = "blacklist" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/firewall/ips" -Method Post -ContentType "application/json" -Body $body
```

**Rules currently disappear when the server restarts**, because the live API still uses
`InMemoryRuleRepository` (see "Current persistence status").

## Testing and verification

```bash
npm run build
npm test
npm run lint
```

The test suite (Vitest) currently covers: validation rules, all four use cases (with a mocked
repository), the in-memory repository's behavior including its atomic delete/update guarantees,
environment configuration validation (including that error messages never leak secret values),
the Winston Logger Singleton, the `PostgresConnection` Singleton and its Stop-and-Wait retry
behavior (fully mocked — no real database required), and the full HTTP API end-to-end via
Supertest against `InMemoryRuleRepository`. Run `npm test` for the current pass/fail status and
test counts, since these change as the project grows.

## Technology stack

- Node.js (v24 LTS) and TypeScript
- Express
- PostgreSQL
- Drizzle ORM (`drizzle-orm`, `drizzle-kit`) with the `pg` driver
- Zod (environment validation)
- Winston (logging)
- Vitest (test runner)
- Supertest (HTTP integration testing)

## Current limitations / roadmap

The following database-related work is **not yet implemented**:

- A row-to-domain mapper (translating between Drizzle rows and `FirewallRule`, including the
  string↔number handling needed for port values stored as `TEXT`).
- A PostgreSQL/Drizzle implementation of the `RuleRepository` port.
- Converting `RuleRepository`, the use cases, and the controller to an async flow — the current
  port and use cases are fully synchronous, which a real database-backed repository cannot
  satisfy without this change.
- Wiring `PostgresConnection` into `server.ts` so the server actually connects to PostgreSQL and
  uses a PostgreSQL-backed repository instead of `InMemoryRuleRepository`.
- A graceful database shutdown hook (e.g. on `SIGINT`/`SIGTERM`) once the server is wired to
  PostgreSQL — `PostgresConnection.shutdown()` exists but nothing currently calls it from
  `server.ts`.
- Integration tests that exercise a real PostgreSQL-backed repository (CRUD and atomicity),
  mirroring the existing `InMemoryRuleRepository` test coverage.

## How the request flow works (beginner-friendly walkthrough)

This section explains, in plain language, what happens when the server starts and handles a
request. No prior backend experience needed.

1. `npm run dev` starts `src/main/server.ts`.
2. `server.ts` creates an `InMemoryRuleRepository` instance.
3. `createApp` (in `app.ts`) builds the Express application: JSON body parsing, request logging,
   the firewall routes, a 404 handler, and an error handler, in that order.
4. Express starts listening for HTTP requests on `PORT`.
5. A client (curl, PowerShell, Postman) sends a request, e.g. `POST /api/firewall/ips`.
6. The matching route in `firewallController.ts` extracts the request body and calls the
   corresponding use case.
7. The use case validates the input (is the IP actually valid? is the mode one of the two
   allowed values?) and, if valid, calls a method on the injected `RuleRepository`.
8. The repository (currently always `InMemoryRuleRepository`) adds, retrieves, updates, or
   removes the rule(s) in its internal array.
9. The controller sends the use case's result back as JSON, with the appropriate status code.
10. If validation fails at step 7, a `ValidationError`/`NotFoundError` is thrown instead, caught
    by the route's `try/catch`, and passed to Express's error-handling middleware, which converts
    it into the standardized `{status, code, message}` JSON error response.
11. Because storage is in memory only, all rules are lost when the process restarts.

**Dependency injection**: the repository is created once, in `server.ts`, and passed into
`createApp`/the use cases from the outside — no use case ever constructs its own repository.
This is what makes it possible to swap `InMemoryRuleRepository` for a PostgreSQL-backed
repository later by changing only `server.ts`, without touching any use case, controller, or
route.
