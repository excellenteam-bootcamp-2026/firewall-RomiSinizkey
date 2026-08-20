# Firewall Orchestrator API

A Node.js and TypeScript orchestrator API for managing firewall rules — IP addresses, domains,
and ports — organized into blacklist and whitelist lists. The project is structured with
Hexagonal (Ports & Adapters) Architecture, and persists rules in PostgreSQL via Drizzle ORM.

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

The firewall rule routes below are mounted under `/api/firewall`; a separate `GET /health`
liveness route is mounted at the application root (see below). Request/response shapes were
verified directly against the controller
(`src/adapters/inbound/http/controllers/firewallController.ts`) and the validators
(`src/application/validation/ruleValidation.ts`).

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

### `GET /health`

Mounted outside `/api/firewall`, at the application root. A pure liveness check: it does not
query PostgreSQL, call any repository, or depend on database availability in any way — it
responds `200` even if the database connection is down. Intended for container/orchestrator
health checks (Docker `HEALTHCHECK`, Compose `service_healthy`), not for verifying database
readiness.

Success — `200`:

```json
{ "status": "ok" }
```

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
  schema, the database connection manager, a pure row/domain mapper (`ruleMapper.ts`), and
  `DrizzleRuleRepository` — a full `RuleRepository` implementation (see below). This is the
  repository the running server actually uses — see "Current persistence status."
- **`src/main`** — the composition root: `env.ts` (configuration), `Logger.ts` (Winston
  Singleton), `startServer.ts` (application composition and lifecycle orchestration — connects to
  PostgreSQL, constructs `DrizzleRuleRepository`, builds the Express app via `createApp`, starts
  listening, and registers graceful shutdown), and `server.ts` (the thin process entry point:
  loads `.env`, calls `startServer()`, and exits non-zero if startup fails).
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

The repository at the bottom of that chain is **`DrizzleRuleRepository`** when the app is started
normally (`npm run dev` / `npm start`) — see "Current persistence status" below.
`InMemoryRuleRepository` is no longer used by the running server at all, but remains in the
codebase and is still what every unit test and the HTTP integration test suite
(`tests/integration/http/`) construct directly, since they test `createApp`/the use cases in
isolation without needing a real database.

Every step in this chain — the `RuleRepository` port, all four use cases, and the controller's
route handlers — is asynchronous (`Promise`-based, using `async`/`await`), so a real database call
at the bottom of the chain doesn't block the event loop. `InMemoryRuleRepository` still resolves
immediately (no real I/O), so this is invisible to its behavior; it's what makes
`DrizzleRuleRepository` a drop-in replacement for it — the same `createApp(repository)` factory
and the same `RuleRepository` interface are used either way.

## Current persistence status

**The running server is PostgreSQL-backed.** Starting the app the normal way (`npm run dev` /
`npm start`) now goes through `src/main/startServer.ts`, which:

1. Connects to PostgreSQL via the Issue #28 `PostgresConnection` Singleton (Stop-and-Wait retry,
   reused unchanged — not reimplemented).
2. Constructs a `DrizzleRuleRepository` using the connected Drizzle database instance.
3. Builds the Express app via the existing `createApp(repository)` factory and starts listening
   — **only after** the database connection has succeeded.
4. Registers `SIGINT`/`SIGTERM` handlers for graceful shutdown.

`InMemoryRuleRepository` is **no longer used by the live server** — it remains in the codebase
solely for unit tests and the HTTP integration test suite (`tests/integration/http/`), which
construct it directly and never touch a real database.

If the PostgreSQL connection fails (Stop-and-Wait exhausts all attempts), `app.listen` is never
called, the failure is logged, and the process exits with a non-zero code — the server does not
come up in a half-working, database-less state. See "Server startup and graceful shutdown" below
for the full sequence, and "Manual API testing" for a persistence check performed against a real
database.

## PostgreSQL and Drizzle setup

1. **Install PostgreSQL** locally (or have access to a running instance). Any reasonably current
   PostgreSQL version works — nothing in this project depends on a specific server version.
2. **Create the development database once**, e.g. via `psql` or a GUI tool:
   ```sql
   CREATE DATABASE firewall_dev;
   ```
3. **Create the isolated test database too**, if you plan to run the PostgreSQL integration tests
   locally (see "Integration-test-only variables" below) — same server, a second, separate
   database:
   ```sql
   CREATE DATABASE firewall_test;
   ```
   **The database itself must exist before running migrations against it** — `npm run db:migrate`
   applies schema changes inside a database, it does not create the database.
4. **DBeaver** (optional) — a free graphical client for browsing tables and running ad-hoc SQL
   queries against the same PostgreSQL instance; it is a database management tool only. **The
   application itself never goes through DBeaver** — `src/main/startServer.ts` connects straight
   to PostgreSQL via the `pg` driver (see "Database connection management" below); DBeaver is
   purely for humans to inspect the database out-of-band.
5. **Configure `.env`** — copy `.env.example` to `.env` and fill in your local database
   credentials (see "Environment variables" below). `.env` is git-ignored and must never be
   committed.
6. **Schema and migrations** — the Drizzle schema lives at
   `src/adapters/outbound/persistence/postgres/schema.ts`; generated SQL migrations and their
   tracking metadata live under `drizzle/`.
7. **Generate a migration** after changing the schema:
   ```bash
   npm run db:generate
   ```
8. **Apply migrations** to your (already-created) database:
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

### Integration-test-only variables

`tests/integration/db/testDatabase.ts` reads these directly — they are **not** part of
`src/main/env.ts`'s Zod schema and are never read by the running application. Leave them unset
to skip the `DrizzleRuleRepository` integration tests locally.

| Variable | Purpose |
|---|---|
| `TEST_DB_HOST` | Host for the isolated integration-test database. |
| `TEST_DB_PORT` | Port for the isolated integration-test database. |
| `TEST_DB_USER` | Username for the isolated integration-test database. |
| `TEST_DB_PASSWORD` | Password for the isolated integration-test database. |
| `TEST_DB_NAME` | Database name — **must end with `_test`**; the test suite refuses to run (before any migration, cleanup, or query) otherwise, so it can never target `firewall_dev` or any other non-test database. |

**Why the `_test` suffix is enforced:** the integration tests migrate, insert into, and delete
from whatever database `TEST_DB_NAME` points at. Requiring a `_test` suffix is a cheap,
mechanical safeguard against a copy-paste or misconfiguration mistake (e.g. accidentally reusing
`DB_NAME`'s value) that would otherwise let a test run destroy real development or production
data — the check runs before the test suite does anything else, so a wrong value fails loudly
instead of silently operating on the wrong database.

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
- **Stop-and-Wait retry with Exponential Backoff** — on connection failure, it waits before
  trying again, one attempt at a time (never in parallel), up to a bounded
  `MAX_CONNECTION_ATTEMPTS` (currently 5). The wait is not a fixed interval: it starts at
  `DB_CONNECTION_INTERVAL` and **doubles after every failed attempt**
  (`computeBackoffDelayMs(initialDelayMs, failedAttempt) = initialDelayMs * 2^(failedAttempt - 1)`),
  giving PostgreSQL progressively more time to come up before each retry. The first attempt is
  always immediate (no delay beforehand), and no delay is scheduled after the final failed
  attempt. Example with `DB_CONNECTION_INTERVAL=1000`:

  | Attempt | When it happens |
  |---|---|
  | 1 | Immediately |
  | 2 | After waiting 1000 ms |
  | 3 | After waiting 2000 ms more |
  | 4 | After waiting 4000 ms more |
  | 5 | After waiting 8000 ms more |

  Every retry delay is logged (e.g. `retrying in 4000ms (Exponential Backoff)`) so the behavior
  is observable without reading source code.
- **Concurrent-call protection** — if `connect()` is called again while a connection attempt is
  already in progress, the second call shares the same in-flight attempt instead of starting a
  parallel one.
- **Shutdown** — a `shutdown()` method closes the pool and resets internal state; it is safe to
  call more than once.

**This connection manager is called from `src/main/startServer.ts`** at startup — the running
server establishes its PostgreSQL connection through this exact Singleton (see "Server startup
and graceful shutdown" below), not through any separate or duplicated connection logic.

## Row and insert mapping

`src/adapters/outbound/persistence/postgres/ruleMapper.ts` is a pure, dependency-free mapper
between Drizzle rows and the `FirewallRule` domain model — it opens no database connection and is
unit-tested with plain objects only:

- **`toDomainRule(row)`** — converts a Drizzle `firewall_rules` row into a `FirewallRule`. `id`,
  `type`, `mode`, and `active` are carried over as-is; IP and domain `value`s stay strings, and a
  port `value` stored as text (e.g. `"443"`) is converted to a number (`443`). An invalid `type`,
  an invalid `mode`, non-numeric port text (e.g. `"abc"`), or an out-of-range port are all
  rejected via the same validators the HTTP layer already uses (`ruleValidation.ts`), instead of
  being cast or passed through silently.
- **`toInsertRow(rule)`** — converts a new domain rule (`NewFirewallRule`) into the object Drizzle
  needs for an insert. IP and domain `value`s stay strings; a numeric port `value` (e.g. `8080`)
  is converted to text (`"8080"`) for storage. New rows are always inserted with `active: true`,
  matching how `InMemoryRuleRepository` already treats new rules.

Row and insert types (`FirewallRuleRow`, `NewFirewallRuleRow`) are inferred directly from the
Drizzle schema (`typeof firewallRules.$inferSelect` / `$inferInsert`) rather than hand-duplicated,
and neither type is exposed outside this adapter — `domain/` and `application/` still know
nothing about Drizzle.

**This mapper is now used by `DrizzleRuleRepository`** (see below) for every row it reads or
writes — no conversion logic is duplicated between the two files.

## DrizzleRuleRepository

`src/adapters/outbound/persistence/postgres/DrizzleRuleRepository.ts` implements the full
`RuleRepository` port using Drizzle, reusing the row/domain mapper above (`toDomainRule` /
`toInsertRow`) for every row it reads or writes:

- **`add(rules)`** — a single `INSERT ... RETURNING`, mapped back through `toDomainRule` and
  sorted by `id` ascending (Postgres doesn't guarantee `RETURNING` row order). An empty array
  short-circuits to `[]` without issuing a query.
- **`getAll(type?)`** — a single `SELECT`, optionally filtered by `type`, always
  `ORDER BY id ASC` for deterministic results.
- **`removeByIds(ids)`** and **`updateStatus(ids, active)`** — both run inside one PostgreSQL
  transaction: `SELECT ... FOR UPDATE` locks exactly the requested rows first, closing the race
  between checking which ids exist and acting on them; only if every id exists does the
  `DELETE`/`UPDATE ... RETURNING` run, still under the same locks. If any id is missing, nothing
  is written — the transaction commits as a no-op — and `{ removed: [], missingIds }` /
  `{ updated: [], missingIds }` is returned, exactly mirroring `InMemoryRuleRepository`'s atomic
  behavior (including that a missing id repeated twice in the request appears twice in
  `missingIds`). An empty `ids` array short-circuits before any transaction or query.

`DrizzleRuleRepository`'s constructor takes a plain `NodePgDatabase`, not `PostgresConnection`
itself, so it can be constructed and tested with any Drizzle database instance without touching
the app's connection Singleton.

**`src/main/startServer.ts` constructs the `DrizzleRuleRepository` the live server uses** — see
"Current persistence status" and "Server startup and graceful shutdown."

## Server startup and graceful shutdown

`src/main/startServer.ts` exports `startServer()`, the application's composition and lifecycle
orchestration function. `src/main/server.ts` itself is now a thin process entry point — it loads
`.env` and calls `startServer()`, catching any failure so it can never surface as an unhandled
Promise rejection:

```ts
startServer().catch((err) => {
  logger.error("[server] failed to start", { err });
  process.exit(1);
});
```

**Startup sequence** (all asynchronous):

1. `await postgresConnection.connect()` — reuses the Issue #28 Singleton and its Stop-and-Wait
   retry unchanged; nothing after this line runs until it resolves.
2. Construct `DrizzleRuleRepository` with the connected Drizzle database instance.
3. Build the Express app via `createApp(repository)` (the existing, unchanged factory).
4. `app.listen(config.port, ...)` — **only reached once steps 1–3 have succeeded.** A successful
   connection and a successful startup are both logged (host/port/database name only — the
   PostgreSQL username and password are never logged, by `PostgresConnection` or by
   `startServer.ts`).

If step 1 fails (all Stop-and-Wait attempts exhausted), steps 2–4 never run — no `RuleRepository`
is constructed, the Express app is never built, and `app.listen` is never called. The rejection
propagates to `server.ts`'s `.catch()`, which logs the failure and calls `process.exit(1)`: the
server does not start in a broken, database-less state.

**Shutdown sequence**, triggered by `SIGINT` (e.g. pressing **Ctrl+C** in the terminal running
`npm run dev`/`npm start`) or `SIGTERM` (e.g. `kill <pid>`, or how most process managers and
container runtimes ask a process to stop):

1. An internal flag makes shutdown idempotent — a second signal, or a second manual call, is a
   safe no-op rather than closing anything twice.
2. The HTTP server stops accepting new connections and closes (`httpServer.close()`).
3. The PostgreSQL pool is closed via `postgresConnection.shutdown()` — **always attempted**, even
   if step 2 fails, so a failed HTTP close can never leak the pool.

This flow is covered by `tests/unit/main/startServer.test.ts` with the database connection,
repository, and Express app all mocked (see "Testing and verification").

## Installation and running

PostgreSQL must already be running and `.env` must be configured before starting the server —
`npm run dev`/`npm start` now waits for a successful database connection before serving any HTTP
traffic (see "Server startup and graceful shutdown" above), and `npm run db:migrate` needs the
same connection too.

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

**Rules now persist across server restarts**, because the live API is backed by
`DrizzleRuleRepository` (see "Current persistence status") — this was verified manually:

1. `npm run dev`, then add a rule (e.g. the `POST /api/firewall/ips` example above).
2. Inspect the row directly in the database, bypassing the API entirely — either with DBeaver
   (connect to `firewall_dev` → `public` → `firewall_rules`) or `psql`:
   ```sql
   SELECT id, type, mode, value, active FROM firewall_rules;
   ```
   The row is present with the exact `type`/`mode`/`value`/`active` that were sent.
3. Stop the server and start it again (`npm run dev`).
4. `GET /api/firewall/rules` — the same rule is still there, because it lives in PostgreSQL, not
   in the process's memory.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm run dev` logs `[postgres] connection attempt 1/5 ...` repeatedly, then `connection failed after 5 attempts` and the process exits | **PostgreSQL isn't running**, or is listening on a different host/port than `DB_HOST`/`DB_PORT` | Start your local PostgreSQL service; confirm it's reachable (e.g. `psql -h <DB_HOST> -p <DB_PORT> -U <DB_USER>`); fix `.env` if the host/port is wrong. |
| Connection attempts fail immediately with an authentication error (e.g. `password authentication failed for user ...`) | **Wrong credentials** — `DB_USER`/`DB_PASSWORD` in `.env` don't match what PostgreSQL actually has configured for that user | Correct `DB_USER`/`DB_PASSWORD` in `.env` (never commit the real value — `.env` is git-ignored). |
| Connection attempts fail with something like `database "firewall_dev" does not exist` | **The database itself was never created** — `npm run db:migrate` only applies schema *inside* an existing database, it does not create one | `CREATE DATABASE firewall_dev;` (or `firewall_test` for the test DB) via `psql`/DBeaver, then re-run migrations. |
| The server connects fine, but requests fail with a Postgres error mentioning `relation "firewall_rules" does not exist` | **Migrations were never applied** to this database | Run `npm run db:migrate` against it. |
| `npm run db:migrate` (or the app's own connection) fails with an SSL-related error (e.g. `the server does not support SSL connections` or the reverse, a certificate error) | **SSL mismatch** between the client and server — most local PostgreSQL installs don't have SSL enabled, but a client may still expect it | This repo already sets `ssl: false` in `drizzle.config.ts` for migrations; the app's own connection (`pg.Pool` in `connection.ts`) also doesn't request SSL. If you're pointing at a remote/cloud database that *requires* SSL, that's a configuration difference from this project's default local setup, not a bug in the app. |
| Running `psql` directly gives `fe_sendauth: no password supplied` | `psql` prompts for a password interactively; it wasn't provided | Either let `psql` prompt you and type it in, pass `-W`, or set the `PGPASSWORD` environment variable for that one command (avoid putting it in shell history or scripts). |
| `npm test` shows `17 skipped` and no PostgreSQL integration tests actually ran | **Expected when `TEST_DB_*` isn't configured** — `tests/integration/db/` skips itself by design so `npm test` stays offline-safe by default (see "Environment variables" and "Testing and verification") | To actually run them locally: create `firewall_test` (see "PostgreSQL and Drizzle setup"), set `TEST_DB_*` in your shell or `.env`, and re-run `npm test`. In CI this is already handled — `.github/workflows/ci.yml` provisions an ephemeral PostgreSQL service with these variables pre-set. |

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
behavior (fully mocked — no real database required), the PostgreSQL row/domain mapper
(`ruleMapper.ts`, plain objects only — no database connection), `DrizzleRuleRepository` against a
real, isolated PostgreSQL database (`tests/integration/db/`, including its transactional
atomicity), the server startup/shutdown composition flow (`tests/unit/main/startServer.test.ts`
— database connection, repository, and Express app all mocked; verifies connect-before-listen
ordering, repository injection, startup failing safely, and idempotent graceful shutdown), and
the full HTTP API end-to-end via Supertest against `InMemoryRuleRepository`.

The `DrizzleRuleRepository` integration tests skip automatically when no test database is
configured (`TEST_DB_NAME` unset — see "Environment variables"), so `npm test` stays fully
offline for anyone without a local PostgreSQL instance. As of this update:

- **Without a test database:** 171 tests passed, 17 skipped (13 test files, 1 of them skipped).
- **With `TEST_DB_*` pointed at an isolated `..._test` database:** all 188 tests pass.

GitHub Actions (`.github/workflows/ci.yml`) starts an ephemeral PostgreSQL 16 service container
for every run and points `TEST_DB_*` at it, so CI always exercises the full suite, including the
database integration tests — against a disposable container, never a persistent or development
database.

Beyond the automated suite, PostgreSQL persistence was also verified manually end-to-end (see
"Manual API testing"): a rule added through the live `npm run dev` server was confirmed present
directly in `firewall_rules` via a raw database query, and was still returned by `GET
/api/firewall/rules` after fully stopping and restarting the server process. Run `npm test` for
the current pass/fail status and test counts, since these change as the project grows.

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

✅ **Done — PostgreSQL integration is complete (Issues #27–#31):**

- The Drizzle schema, initial migration, and the `PostgresConnection` Singleton with Stop-and-Wait
  retry (Issues #27–#28).
- The row/domain mapper (`ruleMapper.ts`) — translating between Drizzle rows and `FirewallRule`,
  including the string↔number handling needed for port values stored as `TEXT` (Issue #29).
- Converting `RuleRepository`, all four use cases, and the controller to an asynchronous
  (`Promise`-based) flow, and `DrizzleRuleRepository` — a full, transactional `RuleRepository`
  implementation tested against a real, isolated PostgreSQL database (Issue #30).
- Wiring PostgreSQL into the live server: `startServer.ts` connects to PostgreSQL and constructs
  `DrizzleRuleRepository` before the app starts listening, `server.ts` is now a thin entry point,
  and graceful shutdown (`SIGINT`/`SIGTERM`, closing both the HTTP server and the PostgreSQL pool,
  idempotently) is implemented and tested (Issue #31).

There is no PostgreSQL-integration work currently pending from Issues #27–#31 — the running
server persists rule data in PostgreSQL, verified both by the automated suite and manually (see
"Testing and verification").

## How the request flow works (beginner-friendly walkthrough)

This section explains, in plain language, what happens when the server starts and handles a
request. No prior backend experience needed.

1. `npm run dev` starts `src/main/server.ts`, which calls `startServer()` (`startServer.ts`).
2. `startServer()` connects to PostgreSQL (awaiting a successful connection, with Stop-and-Wait
   retry) and creates a `DrizzleRuleRepository` instance from that connection.
3. `createApp` (in `app.ts`) builds the Express application: JSON body parsing, request logging,
   the firewall routes, a 404 handler, and an error handler, in that order.
4. Express starts listening for HTTP requests on `PORT` — only after step 2 has succeeded.
5. A client (curl, PowerShell, Postman) sends a request, e.g. `POST /api/firewall/ips`.
6. The matching route in `firewallController.ts` extracts the request body and calls the
   corresponding use case.
7. The use case validates the input (is the IP actually valid? is the mode one of the two
   allowed values?) and, if valid, `await`s a method on the injected `RuleRepository`.
8. The repository — `DrizzleRuleRepository` for the live server — runs the corresponding SQL
   operation via Drizzle and returns `FirewallRule` domain objects (via the Issue #29 mapper).
   Unit and HTTP integration tests use `InMemoryRuleRepository` instead, satisfying the same
   interface without a real database.
9. The controller sends the use case's result back as JSON, with the appropriate status code.
10. If validation fails at step 7, a `ValidationError`/`NotFoundError` is thrown instead, caught
    by the route's `try/catch`, and passed to Express's error-handling middleware, which converts
    it into the standardized `{status, code, message}` JSON error response.
11. Because storage is in PostgreSQL, rules survive a server restart — see "Manual API testing"
    for a verified example. (Only the test suites' `InMemoryRuleRepository` loses its data when
    the process using it ends, which is expected and intentional for tests.)

**Dependency injection**: the repository is created once — in `startServer.ts` for the live
server, or directly by each test for tests — and passed into `createApp`/the use cases from the
outside; no use case ever constructs its own repository. This is exactly what made it possible to
swap `InMemoryRuleRepository` for `DrizzleRuleRepository` in production (Issue #31) by changing
only `main/`, without touching any use case, controller, or route — and it's why the test suites
never had to change to keep using `InMemoryRuleRepository` directly.
