# Firewall Orchestrator API

A Node.js and TypeScript orchestrator API for managing firewall rules — IP addresses, domains,
and ports — organized into blacklist and whitelist lists. The project is structured with
Hexagonal (Ports & Adapters) Architecture, and persists rules in PostgreSQL via Drizzle ORM.

## New Computer Setup

One-time steps after cloning this repository, before daily development. Requires
[Docker Desktop](https://www.docker.com/products/docker-desktop/) (or a Docker Engine + Compose v2
install) — see "Docker prerequisites" below for how to confirm it's actually running, not just
installed.

1. **Create the two local environment files** — each is copied from a committed, safe template
   and then filled in with real values. Neither is ever committed (`.gitignore` blocks
   `.env.dev`/`python-rule-service/.env.dev` everywhere in this repo, while explicitly allowing
   the `.example` templates):
   ```bash
   cp .env.dev.example .env.dev
   cp python-rule-service/.env.dev.example python-rule-service/.env.dev
   ```
2. **Fill in credentials that must be set manually** — both files ship with placeholder values
   that work for local development *except* the CloudAMQP line, which must point at a real hosted
   RabbitMQ instance:
   - In `.env.dev` **and** `python-rule-service/.env.dev`: replace `CLOUDAMQP_URL` with your real
     [CloudAMQP](https://www.cloudamqp.com/) connection URL (and the matching
     `RABBITMQ_QUEUE`/`RABBITMQ_ROUTING_PREFIX` if you don't use the defaults). Use the **same**
     CloudAMQP URL in both files — Node publishes and Python consumes from the same broker.
   - The `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` in `.env.dev` and the matching
     `postgres:...@postgres:5432/...` segment of `python-rule-service/.env.dev`'s `DATABASE_URI`
     already agree with each other out of the box (both default to `change_me`) — change the
     password in both places together if you want a non-default one, since PostgreSQL's container
     is initialized from `.env.dev` alone but Python connects using its own file.
3. **Start everything** (see "Daily Development" below) and confirm it comes up cleanly:
   ```bash
   npm run dev:all
   npm run dev:logs
   ```

## Daily Development

Normal day-to-day development is one command:

```bash
npm run dev:all
```

This runs `docker compose --env-file .env.dev -f docker-compose.dev.yml up --build -d`, which
starts three containers together — PostgreSQL, the Node backend, and the Python RabbitMQ consumer
(see "Docker" below for what each one does and how they're wired). The `--env-file .env.dev` flag
is required, not optional: the `postgres` service's `POSTGRES_USER`/`POSTGRES_PASSWORD`/
`POSTGRES_DB` are Compose-level `${...}` variable interpolation, resolved from the environment
Compose itself runs in — a service-level `env_file:` only injects variables into that one
container at runtime, **after** Compose has already needed those values to render the file. Without
`--env-file .env.dev`, those three variables resolve to empty strings and Postgres starts
misconfigured.

| Task | Command |
|---|---|
| Start everything (build + detached) | `npm run dev:all` |
| Stop everything (keeps the database volume) | `npm run dev:down` |
| Follow logs from all three containers | `npm run dev:logs` |
| Restart all three containers | `npm run dev:restart` |
| Restart only the Python consumer (e.g. after editing its code) | `npm run dev:restart:python` |

Node's HTTP server hot-reloads automatically on save (`ts-node-dev --poll`, already the existing
behavior — see "Development Compose" below). The Python consumer does not auto-restart on save;
run `npm run dev:restart:python` after editing it — see
`python-rule-service/README.md`'s "Docker development hot reload" section for why that's a
deliberate choice, not a gap.

**Rebuilding after a dependency change** (`package.json`/`requirements.txt` edited):
```bash
npm run dev:all   # --build is already part of this script; it rebuilds changed images
```

**Resetting the local PostgreSQL volume** (only when you intentionally want to wipe local dev
data — e.g. to test migrations from scratch):
```bash
npm run dev:down
docker volume rm firewall-romisinizkey_postgres_data_dev
npm run dev:all
```
There is no `-v` shortcut wired into any npm script on purpose — deleting the volume is
destructive and irreversible, and should always be a deliberate, explicit step (see the
"Docker cleanup" warning below for the same reasoning applied to `down -v`).

**Optional fallback — running without Docker:** each service can still run natively, against a
locally installed (or otherwise reachable) PostgreSQL. See "Running Without Docker" below for the
full workflow — it is not the primary workflow described in this README, but it is a complete,
independently usable one, for debugging, learning, or environments where Docker Desktop itself is
unavailable.

## How Docker Development Works

`npm run dev:all` is Docker Compose managing three separate containers, each running one part of
the system:

```
Docker Compose (docker-compose.dev.yml)
│
├── postgres           PostgreSQL 16 — the shared database
│
├── backend             Node.js / TypeScript API (this repo's root)
│
└── python-consumer     Python RabbitMQ consumer (python-rule-service/)
```

- **Each service runs in its own container**, built from its own image (`Dockerfile` at the repo
  root for `backend`, `python-rule-service/Dockerfile` for `python-consumer`) — they don't share a
  filesystem, a process, or a `node_modules`/`site-packages` directory.
- **Compose creates one internal network** (`firewall-romisinizkey_default`) that all three
  containers join automatically. Containers on this network reach each other by **service name**,
  not by IP or `localhost`.
- **Inside the network, PostgreSQL is reached as `postgres:5432`, never `localhost:5432`.** This is
  the single most common point of confusion switching between Docker and manual workflows:
  `localhost` inside a container always refers to *that container itself*, not the host machine or
  any other container. `backend` and `python-consumer` are both configured (via `.env.dev` /
  `python-rule-service/.env.dev`) to connect to `postgres`, the Compose service name — not
  `localhost`, and not `host.docker.internal`.
- **PostgreSQL's port is also published to the host** (`"5432:5432"` in `docker-compose.dev.yml`),
  purely for convenience — so a GUI tool like DBeaver, running directly on your Windows machine
  (outside any container), can connect using:
  ```
  Host: localhost
  Port: 5432
  ```
  This publishing is a deliberate development-only convenience — `docker-compose.prod.yml`
  intentionally does not publish this port (see "Docker" below).
- **The Node API is reachable at `http://localhost:3000`** from the host, the same way — `"3000:3000"`
  is published for `backend`.
- **RabbitMQ is not a container in this Compose file, in development or otherwise.** Both `backend`
  and `python-consumer` connect out to the same hosted [CloudAMQP](https://www.cloudamqp.com/)
  instance over the internet, using the `CLOUDAMQP_URL` in each service's own `.env.dev` file —
  there is nothing to publish or reach by service name for RabbitMQ, since it isn't local at all.
- **PostgreSQL data persists in a named volume** (`postgres_data_dev`) that survives `npm run
  dev:down`, container recreation, and image rebuilds — see "Data persistence and volumes" below.

## Running Without Docker

A complete, independently usable manual workflow — useful for debugging, learning what each
service actually needs to run, or on a machine where Docker Desktop isn't available. **Docker
(`npm run dev:all`) remains the recommended day-to-day workflow** — this section documents the
alternative, not a replacement.

Without Docker, you are responsible for starting and configuring PostgreSQL, the Node backend, and
the Python consumer **separately**, each in its own terminal. Unlike the Docker workflow, every
service here talks to PostgreSQL via `localhost` (not the Compose service name `postgres`), since
nothing is containerized and everything runs directly on the host.

### PostgreSQL without Docker

A PostgreSQL server must already be available — installed locally, or otherwise reachable over the
network. Create the development database once (see "PostgreSQL and Drizzle setup" above for the
full walkthrough, including the optional test database):

```sql
CREATE DATABASE firewall_dev;
```

Both Node's `.env` and Python's `.env` (see below — **not** `.env.dev`, which is Docker-only) need
matching connection details:

| | Value used in `.env.example` / `python-rule-service/.env.example` |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| Database | `firewall_dev` |
| User | `postgres` |
| Password | *(yours — never committed)* |

DBeaver (or any GUI client) connects the same way: `Host: localhost`, `Port: 5432`.

### Node without Docker

```bash
cp .env.example .env   # first time only, then fill in real local DB/CloudAMQP values
npm install
npm run db:migrate
npm run dev
```

`src/main/server.ts`, `src/main/migrate.ts`, and `drizzle.config.ts` each load `.env` automatically
via `dotenv/config` — no `--env-file` flag or manual export is needed, and this is the **plain**
`.env`, not `.env.dev` (which only the Docker workflow reads, and only via Compose's `--env-file`).
`DB_HOST` in this `.env` is `localhost`, not `postgres` — see "How Docker Development Works" above
for why those differ. `npm run dev` uses native file watching (no `--poll`) since there is no
Docker Desktop bind mount to work around — see "Development Compose" below for the Docker-specific
reasoning behind `dev:docker`. This starts Node only: `POST /api/firewall/ips` will accept requests
and return `202`, but nothing persists until the Python consumer (below) is also running.

### Python without Docker

```bash
cd python-rule-service
py -3.13 -m venv .venv        # Windows
.venv\Scripts\activate        # Windows
# python3.11+ -m venv .venv   # Linux/WSL/macOS
# source .venv/bin/activate   # Linux/WSL/macOS

pip install -r requirements.txt
cp .env.example .env          # first time only, then fill in real local DB/CloudAMQP values
python -m src.main
```

`python-rule-service/src/main/config.py` loads `.env` (this service's own, plain `.env` — never
`.env.dev`) by default. `DATABASE_URI` in this `.env` must use `localhost`, not `postgres` — the
same reasoning as Node's `DB_HOST` above: `postgres` is a Docker Compose service name, meaningless
outside a Compose network. `python -m src.main` stays running, consuming messages, until stopped
with `Ctrl+C`.

> [!NOTE]
> **Windows note:** running the Python consumer directly on Windows (outside Docker or WSL) has
> previously failed on this project because Windows Application Control blocked `psycopg`'s
> compiled binary DLL (`psycopg[binary]`'s manylinux wheel is Linux-only in the first place, and
> the Windows-native fallback build hit the same block) — the process could not open a database
> connection at all. This is why Docker is the recommended path for this service specifically: the
> `python-rule-service/Dockerfile` always runs Python on Linux, regardless of host OS, so this
> class of problem cannot occur. If Docker is genuinely unavailable, **WSL** (a real Linux
> environment) is the tested manual fallback — native Windows Python is not guaranteed to work for
> this service.

### RabbitMQ without Docker

No change from the Docker workflow: RabbitMQ is never local, in either case. Both Node's `.env`
and Python's `.env` must point `CLOUDAMQP_URL` (and the matching `RABBITMQ_EXCHANGE`/
`RABBITMQ_QUEUE`/`RABBITMQ_ROUTING_PREFIX`) at the **same** real, hosted CloudAMQP instance — see
"Required environment variables" below. No local RabbitMQ server or container is ever required or
supported by this project.

### Manual startup order

Three terminals, started in this order (each later step depends on the one before it being ready):

1. **PostgreSQL** — already running and reachable at `localhost:5432` (see above).
2. **Terminal 1 — migrations, once**: `npm run db:migrate` (repo root) — applies any pending schema
   changes; safe to re-run, a no-op if nothing changed.
3. **Terminal 1 — Node backend**: `npm run dev` (repo root) — waits for its own PostgreSQL and
   RabbitMQ connections before serving traffic (see "Server startup and graceful shutdown" above).
4. **Terminal 2 — Python consumer**: `cd python-rule-service && python -m src.main` (inside its
   activated `.venv`) — connects to CloudAMQP and starts consuming immediately.
5. **Send requests** — e.g. `POST /api/firewall/ips` to `http://localhost:3000` (see "Manual API
   testing" below); confirm the resulting row lands in PostgreSQL the same way as the Docker
   workflow's "End-to-end verification procedure" above.

**Docker (`npm run dev:all`) is the recommended day-to-day workflow.** This manual workflow is for
debugging, learning, or environments where Docker cannot be used.

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

**Asynchronous, as of Project 7 — see "Project 7: asynchronous command flow" below for the full
picture.** Validates the request, then publishes a command to RabbitMQ instead of writing to
PostgreSQL directly.

```json
{ "values": ["1.2.3.4"], "mode": "blacklist" }
```

Success — `202 Accepted`:

```json
{ "operation_id": "5f2c1e2a-1b3d-4c5e-8f6a-9b0c1d2e3f4a" }
```

No database-generated rule ID is returned — Node no longer knows it, since PostgreSQL is now
written by the Python service after this response is sent, not by Node. See "Project 7" below for
the full path this request takes after the `202`.

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
`DrizzleRuleRepository` a drop-in replacement for it — the same `createApp(repository, ...)`
factory and the same `RuleRepository` interface are used either way.

**`POST /api/firewall/ips` is the one exception to this diagram**, since Project 7: it stops at
validation, then publishes a command through `CommandPublisher` instead of reaching
`RuleRepository` at all. `/domains`, `/ports`, `GET`, `DELETE`, and `PATCH` are unaffected and
still follow the diagram above exactly. See "Project 7: asynchronous command flow" below.

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

## Project 7: asynchronous command flow

`POST /api/firewall/ips` is now an asynchronous slice: Node publishes a command instead of writing
to PostgreSQL directly, and a separate Python service consumes it and performs the actual write.
`/domains`, `/ports`, `GET`, `DELETE`, and `PATCH` are unaffected — they still follow the
synchronous flow described above.

### Architecture diagram

```
Client
  |
  v  POST /api/firewall/ips  { "values": ["1.2.3.4"], "mode": "blacklist" }
Node.js: firewallController.ts
  |
  v
PublishCreateRulesCommandUseCase
  |  validates mode / non-empty values / IPv4
  |  generates operation_id (crypto.randomUUID())
  |  builds the create_rules command
  v
CommandPublisher  (application port — no amqplib type crosses this line)
  |
  v
RabbitMqCommandPublisher  (outbound adapter)
  |  amqplib, one persistent connection + confirm channel, reused across requests
  v
CloudAMQP / RabbitMQ
  exchange:      firewall.commands   (direct)
  routing key:   romi.rule.create
  queue:         romi.firewall.commands
  |
  v
Python: RabbitMqCommandConsumer  (inbound adapter, aio-pika)
  |  JSON-decodes the message body, validates it against the
  |  CreateRulesCommand Pydantic contract (message_models.py)
  v
CreateRulesCommandHandler
  |  binds operation_id into structlog for this command's duration
  |  for each value in payload.values:
  v
AddIpUseCase  (unmodified from Project 6)
  |
  v
SqlAlchemyRuleRepository  (unmodified from Project 6)
  |
  v
PostgreSQL: firewall_rules
  |
  v
message.ack()   <-  only reached if every step above succeeded
```

Node's response (`202 Accepted` + `operation_id`) is sent as soon as RabbitMQ confirms the
publish — **before** any of the Python/PostgreSQL steps below it have necessarily happened. A
`202` means "queued," not "persisted."

### Component responsibilities

| Component | File | Responsibility |
|---|---|---|
| Node producer | `src/adapters/inbound/http/controllers/firewallController.ts`, `src/application/use-cases/PublishCreateRulesCommandUseCase.ts` | Validates the HTTP request, generates `operation_id`, builds the command, calls the publisher — never touches PostgreSQL for this route |
| `CommandPublisher` port | `src/application/ports/CommandPublisher.ts` | The application-layer interface (`publish(command): Promise<void>`) that hides `amqplib` from every layer above it |
| `RabbitMqCommandPublisher` adapter | `src/adapters/outbound/rabbitmq/RabbitMqCommandPublisher.ts` | The only file that imports `amqplib`. Owns the connection + confirm channel lifecycle (opened once at startup, reused, closed on shutdown), serializes the command to JSON, publishes, and awaits broker confirmation before resolving |
| CloudAMQP / RabbitMQ | — (external, hosted by [CloudAMQP](https://www.cloudamqp.com/)) | The durable broker connecting the two services. No local RabbitMQ install or container is used |
| Exchange | `firewall.commands` (direct) | Routes a published message to the right queue by routing key |
| Binding / routing key | `<RABBITMQ_ROUTING_PREFIX>.rule.create` → `romi.rule.create` | Binds the student's queue to the exchange so a shared CloudAMQP instance only delivers this project's commands to this project's queue |
| Queue | `romi.firewall.commands` (durable) | Holds the command until the Python consumer acknowledges it |
| Python consumer | `python-rule-service/src/adapters/inbound/rabbitmq/rabbitmq_consumer.py` | Connects via `aio-pika`, consumes from the queue, decides ack/reject — knows nothing about `AddIpUseCase` or PostgreSQL |
| Message models | `python-rule-service/src/adapters/inbound/rabbitmq/message_models.py` | Pydantic `CreateRulesCommand`/`CreateRulesPayload` — validates the untrusted queue payload's shape before anything touches application code |
| `CreateRulesCommandHandler` | `python-rule-service/src/adapters/inbound/rabbitmq/create_rules_command_handler.py` | Translates a validated command into `AddIpUseCase` calls; binds `operation_id` into structured logs for the duration of processing |
| `AddIpUseCase` | `python-rule-service/src/application/use_cases/add_ip_use_case.py` | The business operation (unmodified since Project 6) — validates the domain rule, calls the repository |
| `SqlAlchemyRuleRepository` | `python-rule-service/src/adapters/outbound/persistence/postgres/sqlalchemy_rule_repository.py` | The only file that writes to `firewall_rules` for this flow (unmodified since Project 6) |

### Message contract

The exact, intentionally minimal shape Node publishes and Python validates — no idempotency key,
correlation ID, config version, or extra metadata:

```json
{
  "operation_id": "5f2c1e2a-1b3d-4c5e-8f6a-9b0c1d2e3f4a",
  "command_type": "create_rules",
  "payload": {
    "type": "ip",
    "mode": "blacklist",
    "values": ["1.2.3.4"]
  }
}
```

`operation_id` must parse as a UUID; `command_type` must be exactly `"create_rules"`;
`payload.type` must be exactly `"ip"`; `payload.mode` must be `"blacklist"` or `"whitelist"`;
`payload.values` must be a non-empty list where every entry is a valid IPv4 address. Any other
shape is rejected before it reaches `CreateRulesCommandHandler`.

### ACK / reject behavior

| Case | Result |
|---|---|
| Invalid JSON, or fails the `CreateRulesCommand` contract | `reject(requeue=False)` — never reaches the handler |
| Handler raises (e.g. the database write fails) | `reject(requeue=False)` — **not** acked as successful |
| Handler completes without raising | `ack()` — the only case that acks |

A message is only acknowledged after `AddIpUseCase`/`SqlAlchemyRuleRepository` actually return
successfully — acking earlier would mean a crash between ack and write permanently loses the
command, since the broker has already discarded it. Failures are not requeued: an unbounded
retry loop with no backoff would hammer a persistently-failing dependency (e.g. a down database)
forever. Redelivery, retry-with-backoff, and idempotency are explicitly deferred — see "Known
limitations" below.

### Required environment variables

Node reads these four (already listed in "Environment variables" above):
`CLOUDAMQP_URL`, `RABBITMQ_EXCHANGE`, `RABBITMQ_QUEUE`, `RABBITMQ_ROUTING_PREFIX`.

Python (`python-rule-service/.env`) reads the same four names, validated independently by its own
Pydantic settings (`python-rule-service/src/main/config.py`) — see
`python-rule-service/README.md`'s "Configuration" section for the full validation rules. The two
services never share a settings object or a `.env` file; each must be configured correctly on its
own.

### Running both services

The primary workflow is Docker Compose — `npm run dev:all` from the repo root starts PostgreSQL,
Node, and the Python consumer together in one command; see "New Computer Setup", "Daily
Development", and "How Docker Development Works" above, and "Docker" below for the full picture.

Both services can also run natively, each in its own terminal, against a locally installed
PostgreSQL — see "Running Without Docker" above ("Manual startup order") for the full,
step-by-step non-Docker workflow. In both cases, Node and Python each need their own `.env`
configured with real CloudAMQP credentials (never committed — see `.env.example` /
`python-rule-service/.env.example` for the placeholder templates); the Python process is
long-lived — it stays running, consuming messages, until stopped with `Ctrl+C` (graceful shutdown,
closing the RabbitMQ connection cleanly).

### End-to-end verification procedure

1. Send `POST /api/firewall/ips` with one IPv4 value; confirm the response is `202 Accepted` with
   an `operation_id`.
2. Open the CloudAMQP management dashboard; confirm the queue shows a connected consumer and the
   Rates graph shows a publish followed by an ack, settling back to 0 ready / 0 unacked.
3. Check the Python service's logs for the same `operation_id`, in order:
   `create_rules_command_received` → `add_ip_succeeded` → `create_rules_command_processed`.
4. Query PostgreSQL directly (or via pgAdmin/DBeaver) for the expected row in `firewall_rules`.

**This procedure was carried out and verified successfully (Issue #75).** Result: `202 Accepted`
with an `operation_id`; the CloudAMQP dashboard showed 1 connected consumer and an ack immediately
after the request, draining back to 0 ready / 0 unacked; Python's logs showed the matching
`operation_id` through all three expected events; and PostgreSQL showed the new row
(`type=ip, mode=blacklist, value=203.0.113.75, active=true`) — independently confirmed by a direct
query in addition to DBeaver. The one issue found during this verification was a local
configuration gap (a leftover placeholder database password in `python-rule-service/.env`, fixed
by the developer), not a defect in this architecture — full debugging narrative in
`AI_CONVERSATION_REPORT.md`.

### Known limitations

- **No retry/backoff** for failed consumer processing — a handler failure is rejected once, not
  retried.
- **No requeue strategy** — rejected messages (both invalid-contract and handler-failure cases)
  are dropped (`requeue=False`), not redelivered or dead-lettered.
- **No idempotency / duplicate protection** — a redelivered or resent message would create a
  second row; nothing currently detects or prevents that.
- **`/domains` and `/ports` remain on the synchronous flow** — only `/ips` was moved to the
  asynchronous RabbitMQ path in Project 7.

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
| `CLOUDAMQP_URL` | Connection URL for the CloudAMQP-hosted RabbitMQ instance (Project 7). |
| `RABBITMQ_EXCHANGE` | The direct exchange commands are published to (`firewall.commands`). |
| `RABBITMQ_QUEUE` | This student/project's durable queue name. |
| `RABBITMQ_ROUTING_PREFIX` | Student-specific routing-key prefix, so a shared CloudAMQP instance only routes commands to this queue. |

RabbitMQ itself is hosted by [CloudAMQP — https://www.cloudamqp.com/](https://www.cloudamqp.com/); there is no local RabbitMQ installation or Docker container in this project's setup. The
publisher builds the routing key as `` `${RABBITMQ_ROUTING_PREFIX}.rule.create` `` — see "Project
7: asynchronous command flow" below for the full picture.

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
`npm run dev`/`npm start` now waits for a successful database connection (and, since Project 7, a
successful RabbitMQ connection too) before serving any HTTP traffic (see "Server startup and
graceful shutdown" above), and `npm run db:migrate` needs the database connection too.

```bash
npm install
npm run db:migrate
npm run dev
```

This starts Node only. `POST /api/firewall/ips` will accept requests and return `202` on its own,
but nothing will persist the resulting rule to PostgreSQL unless the Python consumer
(`python-rule-service/`) is also running — see "Project 7: asynchronous command flow" above.

- `npm run dev` — start the API in watch mode.
- `npm run build` — compile TypeScript to `dist/`.
- `npm start` — run the compiled server (`node dist/main/server.js`).
- `npm run lint` — type-check without emitting.

## Docker

The Node backend has a multi-stage `Dockerfile` with three targets (below); the Python consumer
(`python-rule-service/Dockerfile`) has its own single `development` stage, used only by
`docker-compose.dev.yml` — it has no production Compose entry, since `docker-compose.prod.yml` is
unaffected by the Docker development workflow described here (see "New Computer Setup"/"Daily
Development" above). No database or CloudAMQP credentials are baked into either image at any
stage — they're supplied at container-start time via the env files below, and via Compose
(development: this section; production: Issue #45, Node backend only). **There is no frontend
container** — no frontend exists in this repository yet, so it stays explicitly out of scope here.

### Docker prerequisites

Docker Desktop (or a Docker Engine + Compose v2 install) must be **installed and running** —
installed is not the same as running, and this is the single most common way the commands below
fail. Verify both before doing anything else:

```bash
docker version         # must show both a Client AND a Server section
docker compose version
```

If `docker version` only prints a `Client` section (no `Server`), Docker Desktop is installed but
not started — start it and re-run the command before continuing.

- **`development`** — full dependency tree, runs `npm run dev` (`ts-node-dev`, hot reload).
  Intended to run with the repository bind-mounted over `/app`.
- **`build`** — compiles TypeScript to `dist/`; not run directly, only used as a source for the
  `production` stage below.
- **`production`** — a fresh base with `npm ci --omit=dev`, so devDependencies (`drizzle-kit`,
  `typescript`, `ts-node-dev`, `vitest`, ...) are never present. Runs as a non-root user. On
  start, `npm run start:container` first runs the compiled migration runner
  (`node dist/main/migrate.js`, built from `src/main/migrate.ts` on
  `drizzle-orm/node-postgres/migrator` — **not** `drizzle-kit`, which this image doesn't have),
  then `node dist/main/server.js`; a failed migration stops the container before the server
  starts.

Standalone build/run (without Compose — see "Development Compose" below for the normal workflow):

```bash
docker build --target development -t firewall-backend:dev .
docker build --target production  -t firewall-backend:prod .

docker run --rm -p 3000:3000 \
  -e ENV=dev -e PORT=3000 -e DB_CONNECTION_INTERVAL=2000 \
  -e DB_HOST=host.docker.internal -e DB_PORT=5432 \
  -e DB_USER=postgres -e DB_PASSWORD=change_me -e DB_NAME=firewall_dev \
  firewall-backend:dev
```

`PORT` is fully configurable at runtime — the app always binds `config.port` from `env.ts`
regardless of the image's `EXPOSE` default (3000).

### Docker environment files

`.env.dev.example` and `.env.prod.example` are safe, committed templates — placeholder values
only, no real credentials. The real files Docker reads (`.env.dev`, `.env.prod`) are gitignored
and created locally, once per clone:

```bash
cp .env.dev.example .env.dev
cp .env.prod.example .env.prod
```

Then edit the two new files with real local/production values. Both templates set `DB_HOST` to
`postgres` — the PostgreSQL Compose service name, confirmed by `docker-compose.dev.yml` below
(Issue #45's production file uses the same name). Each template also sets
`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` (read by the official `postgres` image itself,
not by this app) equal to the matching `DB_USER`/`DB_PASSWORD`/`DB_NAME`, so the backend and the
database container are configured from one source of truth. The existing `.env.example` is
unaffected and still describes the plain, non-Docker `npm run dev` workflow (`DB_HOST=localhost`).

The Python consumer has its own, separate pair — `python-rule-service/.env.dev.example`
(committed template) and `python-rule-service/.env.dev` (gitignored, created locally):

```bash
cp python-rule-service/.env.dev.example python-rule-service/.env.dev
```

This is **not** a duplicate of the root `.env.dev` — see "Required environment variables" above:
the two services are always configured independently, never from a shared `.env` file, Docker
included. `python-rule-service/.env.dev`'s `DATABASE_URI` embeds the same `postgres`-service-name
host and the same credentials as the root `.env.dev`'s `POSTGRES_*` values, and its own
`CLOUDAMQP_URL` must be filled in with the same real CloudAMQP connection string used in the root
`.env.dev` — the two services publish to and consume from the same broker.

### Development Compose

`docker-compose.dev.yml` runs PostgreSQL, the Node backend, and the Python RabbitMQ consumer
together with one command — hot reload (Node only — see below), migrations-before-server, a
persistent database volume, and port 5432 published for DBeaver. This is also exactly what
`npm run dev:all` (see "Daily Development" above) runs under the hood:

```bash
cp .env.dev.example .env.dev                                  # first time only
cp python-rule-service/.env.dev.example python-rule-service/.env.dev   # first time only

docker compose --env-file .env.dev -f docker-compose.dev.yml up --build -d   # build + start
docker compose --env-file .env.dev -f docker-compose.dev.yml logs -f backend # follow logs
docker compose --env-file .env.dev -f docker-compose.dev.yml restart backend # restart one service
docker compose --env-file .env.dev -f docker-compose.dev.yml down            # stop; keeps the DB volume
```

`--env-file .env.dev` is required on every command above, not just `up` — `postgres`'s
`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` are Compose-level `${...}` variable
interpolation inside `docker-compose.dev.yml` itself, resolved from the environment Compose runs
in. A service-level `env_file:` (used by `backend` and `python-consumer` below) only injects
variables into that one container at container-start time — too late to affect how Compose
already rendered the file's `${POSTGRES_*}` references. Omitting `--env-file .env.dev` silently
starts Postgres with empty user/password/database values instead of failing loudly.

`postgres` has a `pg_isready` healthcheck; both `backend` and `python-consumer` wait for it via
`depends_on: condition: service_healthy` (not plain `depends_on`, which only waits for the
container to start, not for PostgreSQL to accept connections). The Node repository is bind-mounted
over `/app` for hot reload, with a separate named volume shadowing just `/app/node_modules` so the
host's `node_modules` never overwrites the image's own. On start, the backend container runs
`npm run db:migrate:dev` (source-based, via `ts-node` — the `development` Dockerfile stage never
runs `npm run build`, so the compiled `dist/main/migrate.js` used in production doesn't exist
here) before handing off to hot reload. **Node/Drizzle remains the only schema owner** — the
Python consumer never runs a migration of any kind, in Docker or otherwise (see
`python-rule-service/README.md`'s "Schema and migration ownership").

`python-consumer` builds from `python-rule-service` (its own `Dockerfile`, `development` stage),
loads `python-rule-service/.env.dev` (its own, separate env file — see "Docker environment files"
above), connects to PostgreSQL via the `postgres` service name (never `localhost`), and connects
to the same CloudAMQP-hosted RabbitMQ instance the Node backend publishes to — **there is no
local RabbitMQ container** anywhere in this Compose file, matching the non-Docker workflow. Its
source is also bind-mounted over `/app`, but it does **not** hot-reload on save — see
`python-rule-service/README.md`'s "Docker development hot reload" section for why, and use
`npm run dev:restart:python` after editing it.

Hot reload uses `npm run dev:docker`, **not** plain `npm run dev`, inside this Compose file
specifically: `ts-node-dev`'s file watcher (`chokidar`) only receives native filesystem change
events by default, and those don't reliably cross a Docker Desktop bind mount — verified directly
during Issue #46: an edit to a bind-mounted file never triggered a restart until `--poll` was
added. `dev:docker` is `ts-node-dev --respawn --poll ...`, scoped to this Docker path only; plain
`npm run dev` (outside Docker) is untouched and still uses native watching, no polling overhead.

### Production Compose

```bash
cp .env.prod.example .env.prod   # first time only, then replace every placeholder with a real value

docker compose --env-file .env.prod -f docker-compose.prod.yml up --build -d   # build + start
docker compose --env-file .env.prod -f docker-compose.prod.yml restart backend # restart one service
docker compose --env-file .env.prod -f docker-compose.prod.yml down            # stop; keeps the DB volume
```

**Logs:** unlike development, the production backend logs to `/app/logs/app.log` *inside* the
container, not to stdout (`Logger.ts`'s existing dev-vs-production behavior — see Issue #42) —
so `docker compose ... logs backend` only shows the two `npm` startup lines, nothing from the
running app. To read the real application log:

```bash
docker exec <backend-container-name> cat /app/logs/app.log
```

Same healthcheck-gated startup as development, but everything else is deliberately different:

| | Development | Production |
|---|---|---|
| Dockerfile target | `development` | `production` |
| Source code | Bind-mounted, hot reload | Baked into the image at build time, no bind mount |
| Migrations | `npm run db:migrate:dev` (`ts-node`, Compose `command:` override) | The image's own default `CMD` (`npm run start:container` → compiled `dist/main/migrate.js`, then `dist/main/server.js`) — no override needed |
| Container user | root (image default) | non-root `app` (Issue #42) |
| PostgreSQL port on host | `5432` published, for DBeaver | **Not published** — only reachable from the `backend` container, over the Compose network |
| Database volume | `postgres_data_dev` | `postgres_data_prod` (fully separate; a prod-mode run can never see dev data) |
| Restart policy | none set | `unless-stopped` on both services |

`.env.prod` is created locally the same way as `.env.dev` — copied from the committed
`.env.prod.example` template and never committed itself. Confirm no real production credential is
ever placed in a tracked file before deploying with it.

### Startup order and migrations

Both Compose files enforce the same sequence, verified end-to-end against a real database for
each environment (Issues #44/#45/#46):

1. The `postgres` container starts; its `pg_isready` healthcheck must pass before anything else
   proceeds — `depends_on: condition: service_healthy` on the `backend` service blocks it from
   even starting until this happens (plain `depends_on` would only wait for the postgres
   *container* to start, not for PostgreSQL to actually accept connections).
2. The `backend` container's entrypoint runs database migrations — `db:migrate:dev` (source, via
   `ts-node`) in development, or the image's own default `CMD` (compiled `dist/main/migrate.js`)
   in production. A failed migration exits non-zero and the container stops **before** the server
   ever starts, in both environments.
3. Only after migrations succeed does the server start, connect to PostgreSQL, and begin listening.

### Data persistence and volumes

PostgreSQL data lives in a named volume per environment — `postgres_data_dev` and
`postgres_data_prod` — mounted at `/var/lib/postgresql/data`. These are two entirely separate
volumes: a production-mode run can never see development data, or vice versa. A named volume
survives `docker compose down`, container recreation, and image rebuilds; it is **not** deleted
unless you explicitly ask for that (see "Cleanup" below). The backend's own `node_modules` also
lives in a named volume in development (`backend_node_modules`), for the unrelated reason of
keeping the host's `node_modules` from shadowing the image's under the source bind mount.

### Docker cleanup

```bash
docker compose --env-file .env.dev  -f docker-compose.dev.yml  down   # safe: containers only
docker compose --env-file .env.prod -f docker-compose.prod.yml down   # safe: containers only
```

> [!WARNING]
> Adding `-v` to either command above (`down -v`) also **deletes the named volumes** — this
> permanently destroys the PostgreSQL data for that environment, with no confirmation prompt. Only
> do this deliberately (e.g. to start a fresh database), never as a routine shutdown step.

To also remove the built images (rarely needed — `up --build` already rebuilds on the next run):

```bash
docker rmi firewall-romisinizkey-backend
```

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
| Any `docker`/`docker compose` command fails immediately, e.g. `error during connect ... the system cannot find the file specified`, or hangs | **Docker Desktop is installed but not running** — installed is not the same as running | Start Docker Desktop; confirm with `docker version` that it prints both a `Client` and a `Server` section before retrying. |
| `docker compose ... up` fails with `port is already allocated` / `bind: address already in use` for **port 3000** | Another process (often a leftover `npm run dev`, or a previous container that wasn't fully stopped) is already bound to 3000 | Stop the other process, or change `PORT` in `.env.dev`/`.env.prod` and re-run `up --build`. |
| `docker compose -f docker-compose.dev.yml ... up` fails the same way for **port 5432**, or a host tool connects but gets the wrong data/wrong password | Something else already owns host port 5432 — commonly a native (non-Docker) PostgreSQL install running locally, which will silently answer instead of the Compose container | Stop the other PostgreSQL service before using the dev Compose stack, or connect DBeaver to a different local port by changing the dev file's `5432:5432` mapping (e.g. `55432:5432`) — the production file never publishes this port at all, so it can't happen there. |
| `docker compose ... up` fails fast with something like `env file .env.dev not found` | **`.env.dev`/`.env.prod` don't exist yet** — they're gitignored and created locally per clone, not committed | `cp .env.dev.example .env.dev` (or the `.prod` equivalent), then re-run `up --build`. |
| `docker compose ps` shows `postgres` stuck as `starting` (never `healthy`), and `backend` never starts at all | **PostgreSQL isn't actually coming up healthy** — often wrong/mismatched `POSTGRES_*` values, or a corrupted volume from a previous crash | `docker compose logs postgres` to see the real Postgres startup error; if the data volume itself is suspect, `down -v` **destroys that environment's data** (see "Cleanup") and lets Postgres re-initialize from scratch. |
| The `backend` container exits shortly after starting, before ever reaching `"listening on port ..."` | **Migration failure** — the entrypoint's `&&`/`command:` chain stops the container before the server starts on purpose, per "Startup order and migrations" above | `docker compose logs backend` (development) or `docker exec <container> cat /app/logs/app.log` (production, see "Production Compose" — production logs to a file, not stdout) for the actual Drizzle/Postgres error; fix the underlying cause (e.g. a bad migration, unreachable database), then `up --build` again. |

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

✅ **Done — Project 7, RabbitMQ asynchronous command flow (Issues #70–#75):** `POST
/api/firewall/ips` publishes to CloudAMQP instead of writing directly; a separate Python service
consumes, validates, and persists the rule. Verified end-to-end (Issue #75) — see "Project 7:
asynchronous command flow" above for the full architecture, and its "Known limitations" for what's
explicitly still missing (retry/backoff, requeue strategy, idempotency) — `/domains` and `/ports`
remain on the original synchronous flow.

## How the request flow works (beginner-friendly walkthrough)

This section explains, in plain language, what happens when the server starts and handles a
request. No prior backend experience needed.

1. `npm run dev` starts `src/main/server.ts`, which calls `startServer()` (`startServer.ts`).
2. `startServer()` connects to PostgreSQL (awaiting a successful connection, with Stop-and-Wait
   retry) and creates a `DrizzleRuleRepository` instance from that connection.
3. `createApp` (in `app.ts`) builds the Express application: JSON body parsing, request logging,
   the firewall routes, a 404 handler, and an error handler, in that order.
4. Express starts listening for HTTP requests on `PORT` — only after step 2 has succeeded.
5. A client (curl, PowerShell, Postman) sends a request, e.g. `POST /api/firewall/domains`
   (`/ips` is the one exception to steps 6-9 below — see "Project 7: asynchronous command flow"
   above for its actual path).
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
