# python-rule-service

Independent Python service that is now the sole writer of firewall configuration changes made
through `POST /api/firewall/ips` (Epic #54; Project 7, Issues #70-#75). Project 6 (#55-#61) built
and proved the Add IP write path - domain model, use case, repository port, and a SQLAlchemy/
PostgreSQL implementation - entirely in isolation, through direct local calls only. Project 7
connected it to real traffic: this service now runs as a long-lived process consuming commands
Node publishes to CloudAMQP/RabbitMQ, validating them, and writing the resulting rows to the same
`firewall_rules` table Node's `/domains` and `/ports` routes still write to directly. See "RabbitMQ
consumer (Project 7)" below, and the root `README.md`'s "Project 7: asynchronous command flow" for
the full two-service picture including Node's side.

## Structure

```
src/
  domain/
    entities/firewall_rule.py      RuleMode, NewFirewallRule (self-validating), FirewallRule (#58)
    errors.py                      InvalidIpError (#58)
  application/
    errors.py                      ApplicationError(code, message) (#57)
    ports/rule_repository.py       RuleRepository (abstract, add() only) (#58)
    use_cases/add_ip_use_case.py   AddIpUseCase (#58)
  adapters/outbound/persistence/postgres/
    schema.py                      firewall_rules Table mapping (#59)
    sqlalchemy_rule_repository.py  SqlAlchemyRuleRepository (#59)
  adapters/inbound/rabbitmq/
    message_models.py              CreateRulesCommand/CreateRulesPayload - Pydantic (#73)
    rabbitmq_consumer.py           RabbitMqCommandConsumer - connects, consumes, ack/reject (#73, #74)
    create_rules_command_handler.py  CreateRulesCommandHandler - command -> AddIpUseCase (#74)
  main/
    config.py                      validated Pydantic settings, incl. RabbitMQ vars (#56, #70)
    logger.py                      configured structlog logger + contextvars merging (#57, #74)
    db.py                          SQLAlchemy Engine built from DATABASE_URI (#59)
    __main__.py                    entry point - wires and runs the long-lived consumer (#74)
tests/
  unit/main/test_config.py                     config validation tests (#56)
  unit/main/test_logger.py                     structured output + level filtering (#57)
  unit/main/test_main.py                       entry-point startup event tests (#57)
  unit/main/test_db.py                         engine construction + no-secret-leak (#59)
  unit/application/test_errors.py              ApplicationError tests (#57)
  unit/domain/entities/test_firewall_rule.py   IPv4 validation + domain purity (#58)
  unit/domain/test_errors.py                   InvalidIpError tests (#58)
  unit/application/ports/test_rule_repository.py    port contract tests (#58)
  unit/application/use_cases/test_add_ip_use_case.py  AddIpUseCase tests (#58)
  unit/adapters/inbound/rabbitmq/test_message_models.py           contract validation (#73)
  unit/adapters/inbound/rabbitmq/test_rabbitmq_consumer.py        consume/ack/reject behavior (#73, #74)
  unit/adapters/inbound/rabbitmq/test_create_rules_command_handler.py  handler -> AddIpUseCase (#74)
  unit/conftest.py                shared FakeRuleRepository fixture (#60)
  integration/
    db_test_helpers.py             TEST_DATABASE_URI + the "_test"-suffix safety guard (#59)
    test_db_test_helpers.py        pure guard-logic tests, no real database (#59)
    conftest.py                    shared engine + table-cleanup fixtures (this issue, #60)
    adapters/outbound/persistence/postgres/test_sqlalchemy_rule_repository.py
                                    real PostgreSQL tests against firewall_test (#59)
    test_add_ip_end_to_end.py      AddIpUseCase -> repository -> PostgreSQL (this issue, #60)
  conftest.py                      safe baseline env, so config-dependent test
                                    modules collect regardless of run order
  fixtures/
pytest.ini                          pythonpath = . - makes plain `pytest` work,
                                     not just `python -m pytest` (this issue, #60)
```

## Setup

```
cd python-rule-service
py -3.13 -m venv .venv        # Windows; use `python3.11+ -m venv .venv` elsewhere
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
```

> [!NOTE]
> Running this service natively on Windows has previously failed due to Windows Application
> Control blocking `psycopg`'s binary DLL. Docker (the root `README.md`'s "Running Without Docker"
> → Windows note) or WSL are the tested working paths on Windows; native Windows Python is not
> guaranteed to work.

## Configuration

Copy the placeholder template and fill in real local values - `.env` is gitignored,
`.env.example` is not:

```
cp .env.example .env
```

Validated once at startup by `src/main/config.py` via Pydantic / pydantic-settings,
and exported as a single immutable `settings` object. Nothing else in the service
reads `os.environ` directly.

| Variable       | Validation                                                                 |
|----------------|-----------------------------------------------------------------------------|
| `ENV`          | must be exactly `dev` or `production`                                       |
| `DATABASE_URI` | required, non-blank PostgreSQL connection string                            |
| `LOG_LEVEL`    | must be one of `DEBUG`/`INFO`/`WARNING`/`ERROR`/`CRITICAL` (case-insensitive, normalized to uppercase) |
| `CLOUDAMQP_URL` | required, non-blank connection URL for the CloudAMQP-hosted RabbitMQ instance (Project 7) |
| `RABBITMQ_EXCHANGE` | required, non-blank - the direct exchange this service consumes from (`firewall.commands`) |
| `RABBITMQ_QUEUE` | required, non-blank - this student/project's durable queue name |
| `RABBITMQ_ROUTING_PREFIX` | required, non-blank - student-specific routing-key prefix |

RabbitMQ itself is hosted by [CloudAMQP — https://www.cloudamqp.com/](https://www.cloudamqp.com/); there is no local RabbitMQ installation or Docker container in this project's setup.

`ENV=dev` additionally refuses to start if `DATABASE_URI`'s database name looks
production (contains `prod`) - a safety guard against a development run
accidentally targeting a production database.

Missing or invalid values raise a clear error - listing which field failed and
why - and stop startup immediately. The error message never includes
`DATABASE_URI`, passwords, or any other configured value.

`DATABASE_URI` must include the `+psycopg` driver segment (e.g.
`postgresql+psycopg://user:pass@host:5432/db`) - this service only installs
`psycopg` (v3), and SQLAlchemy's default driver for a bare `postgresql://` URL
is `psycopg2`, which isn't installed and would fail at engine-construction
time.

## Logging

`src/main/logger.py` configures [structlog](https://www.structlog.org/) exactly
once, at import time, using the already-validated `settings.ENV` and
`settings.LOG_LEVEL` (#56) - it is never configured a second time, and it is the
only module that calls `structlog.configure(...)`. Every log call produces a
structured *event* - a stable event name (e.g. `"service_startup"`) plus
whatever contextual fields the caller passes (e.g. `env="dev"`) - rather than a
free-form message string, so log output stays machine-parseable regardless of
how it's rendered:

- `ENV=dev` renders events as colorized, human-readable console lines (still
  carrying the same structured fields underneath).
- `ENV=production` renders the same events as one JSON object per line.

`settings.LOG_LEVEL` sets the minimum severity that is actually emitted - a
`logger.debug(...)` call is silently filtered out when the configured level is
`INFO` or above. The logger is never given `DATABASE_URI`, passwords, or any
other secret as a field; nothing in this service's own code passes one, and
`tests/unit/main/test_main.py` guards the entry point specifically to keep it
that way.

## Application errors

`src/application/errors.py` defines one small `ApplicationError(code, message)`
type - a real, raisable `Exception` subclass with two stable fields: a short
machine-checkable `code` (e.g. `"INVALID_IP"`) and a human-readable `message`.
It carries nothing else - no internal details, no credentials - so its `str()`,
`repr()`, and `to_dict()` are all safe to log or serialize as-is. This mirrors
Node's `AppError`/`ValidationError` precedent, minus the HTTP-specific
`statusCode`, since this service has no inbound HTTP adapter yet.

## Add IP (domain, use case, repository port)

The first ported business operation, mirroring Node's `FirewallRule.ts` /
`AddRulesUseCase.ts` / `RuleRepository.ts` slice - adapted idiomatically for
Python rather than translated line-by-line.

- **Domain** (`src/domain/entities/firewall_rule.py`): `NewFirewallRule(mode, value)`
  validates `value` on construction using Python's standard `ipaddress` module
  (`IPv4Address`, IPv4 only - matching Node's current IPv4-only regex; IPv6 is
  explicitly out of scope for this issue and is rejected) and raises the
  domain-owned `InvalidIpError` (`src/domain/errors.py`) if it isn't a valid,
  plain dotted-decimal string. `FirewallRule` additionally carries `id` and
  `active`, returned after a successful save. The domain has zero imports from
  `application/`, `adapters/`, Pydantic, SQLAlchemy, or `structlog` - enforced by
  a source-scanning test, not just by convention.
- **Repository port** (`src/application/ports/rule_repository.py`): an abstract
  `RuleRepository` with exactly one method, `add(rule) -> FirewallRule`.
  Deliberately minimal - just what `AddIpUseCase` needs - not a port of Node's
  full four-method interface. Implemented concretely by
  `SqlAlchemyRuleRepository` (below, #59).
- **Use case** (`src/application/use_cases/add_ip_use_case.py`): `AddIpUseCase`
  constructs a `NewFirewallRule` (which validates itself); if that raises
  `InvalidIpError`, the use case - not the domain - catches it and raises
  `ApplicationError(code="INVALID_IP", message=...)` instead, then returns
  without ever calling the repository. On success, it calls
  `repository.add(...)` once and returns exactly what the repository returns.
  Logs one structured event either way (`add_ip_rejected` or
  `add_ip_succeeded`) via the Issue #57 logger - `mode` and the rule's `id`/IP
  value only, never a secret.

## PostgreSQL repository

`SqlAlchemyRuleRepository` (`src/adapters/outbound/persistence/postgres/`) is
the concrete `RuleRepository` implementation, reusing the existing
`firewall_rules` table exactly as Node's Drizzle schema defines it (`id`,
`type`, `mode`, `value`, `active`) - no schema changes, no Python migration
system; `schema.py` maps that table with plain SQLAlchemy Core (`Table`), not
the ORM. Only this adapter imports SQLAlchemy - domain and application remain
untouched.

`add(rule)` inserts one row (`type` is always `"ip"` - the only rule type
ported so far, #58 - `mode`/`value` from the domain rule, `active=true`),
using `RETURNING` to read back the database-generated `id` in the same
statement, and maps the result straight into a domain `FirewallRule`. Runs
inside `engine.begin()`, so a failure rolls back automatically.

`src/main/db.py` builds the SQLAlchemy `Engine` once from `settings.DATABASE_URI`
(#56) - construction is lazy, so no connection actually opens at import time.
Nothing in this service prints or logs `str(engine)`/`str(engine.url)`; even if
something did, SQLAlchemy redacts the password in both by default (verified
empirically, and locked in by `tests/unit/main/test_db.py`).

### PostgreSQL integration tests

`tests/integration/` runs against a **real** PostgreSQL database, entirely
separate from the app's own `DATABASE_URI` / `settings` - it reads its own
`TEST_DATABASE_URI` environment variable (`db_test_helpers.py`), mirroring
Node's `TEST_DB_*` / `DB_*` separation, so there is no code path by which
these tests could reach a non-test database through the application's config.

```
TEST_DATABASE_URI=postgresql+psycopg://user:pass@localhost:5432/firewall_test pytest
```

Covers the repository directly (`test_sqlalchemy_rule_repository.py`) and the
complete path wired together
(`test_add_ip_end_to_end.py`: `AddIpUseCase` -> `SqlAlchemyRuleRepository` ->
PostgreSQL), verifying both the returned `FirewallRule` and the row actually
stored. `tests/integration/conftest.py` shares the `engine` and table-cleanup
fixtures between both files - opt-in per module via
`pytest.mark.usefixtures(...)`, never `autouse`, so
`test_db_test_helpers.py`'s pure guard-logic tests keep working with no
`TEST_DATABASE_URI` at all.

**Safety guard:** if `TEST_DATABASE_URI` is set but its database name doesn't
end with `_test`, the guard module raises immediately - before any test in
`tests/integration/` is even collected, since every module there now shares
one conftest.py that imports the guard - refusing to run against
`firewall_dev`, `firewall_prod`, or anything else not obviously disposable.
Left unset, the integration tests are skipped and the rest of the suite stays
fully offline. Each test cleans up every row it creates, before and after -
via a fixture, so cleanup still runs even if the test itself fails.

No local `.env.test` file is required or read for any of this - the real
credentials, if any, live only in the `TEST_DATABASE_URI` value you pass on
the command line.

## Run

```
python -m src.main
```

Loads and validates settings first (#56); if that fails, the process stops before the logger is
even configured. If configuration is valid, the logger is configured and the entry point emits one
structured `service_startup` event with `env` and `configured_log_level` (never `DATABASE_URI` or
`CLOUDAMQP_URL`). As of Project 7 (#74), it then builds the real dependency chain
(`SqlAlchemyRuleRepository` → `AddIpUseCase` → `CreateRulesCommandHandler` →
`RabbitMqCommandConsumer`) and starts the consumer — **the process stays running**, consuming
messages from `RABBITMQ_QUEUE` until stopped with `Ctrl+C` (SIGINT) or SIGTERM, at which point it
logs `service_shutdown_started`/`service_shutdown_complete` and closes the RabbitMQ connection
gracefully. It no longer exits immediately - see "RabbitMQ consumer (Project 7)" below for the
full startup-to-shutdown lifecycle.

## Docker development

This service also runs inside the root `docker-compose.dev.yml`, alongside PostgreSQL and the
Node backend — see the root `README.md`'s "New Computer Setup" and "Daily Development" sections
for the full workflow (`npm run dev:all` from the repo root starts all three). The relevant
pieces specific to this service:

- **`Dockerfile`** — a single `development` stage, Linux (`python:3.13-slim`), so
  `psycopg[binary]`'s manylinux wheel applies the same way on every host OS regardless of whether
  the host itself is Windows, macOS, or Linux. `pip install -r requirements.txt` runs into the
  image's system site-packages, not into `/app` — unlike the Node backend's `node_modules`, no
  shadowing named volume is needed when this directory is bind-mounted over `/app` for
  development, since installed packages and the bind-mounted source never occupy the same path.
- **`.env.dev` / `.env.dev.example`** — separate from `.env`/`.env.example` above. `.env.dev` is
  what the Docker Compose `python-consumer` service's `env_file:` loads; it points `DATABASE_URI`
  at host `postgres` (the Compose service name) instead of `localhost`, since inside the Compose
  network `localhost` would resolve to this container itself, not the database container. Copy
  the template once per clone: `cp .env.dev.example .env.dev`, then fill in the same CloudAMQP
  credentials used elsewhere.

### Docker development hot reload

Unlike the Node backend (which uses `ts-node-dev --poll` inside Docker — see the root README's
"Development Compose" section), this service's `python-consumer` container does **not** run an
auto-restart-on-change tool. This was a deliberate choice, not an oversight:

- The underlying problem is the same one the Node backend hit: a file watcher's default,
  OS-native change events (`chokidar` for Node, `watchdog`'s default `Observer` for Python — both
  ultimately rely on `inotify` inside the Linux container) are not guaranteed to fire reliably for
  edits made from the host side of a Docker Desktop bind mount. Node's fix was verified
  empirically (`--poll` demonstrably fixed it; native watching demonstrably did not).
- `watchdog`/`watchmedo` could in principle be pointed at a polling observer to get the same
  fix, but doing so is not a supported first-class flag of the `watchmedo` CLI, and no equivalent
  verification has been done for this service. Adding an extra dependency (`watchdog`) on the
  strength of an untested assumption would trade a proven-reliable manual step for a
  plausible-but-unverified automatic one — the opposite of what a consumer that silently drops
  messages on a crash should optimize for.
- Restarting a background consumer is cheap and explicit: no browser tab or open HTTP connection
  depends on it staying up mid-edit, unlike the Node API. A manual restart after saving a change
  is a one-line command and impossible to get subtly wrong:
  ```
  npm run dev:restart:python
  ```
  (equivalently, `docker compose --env-file .env.dev -f docker-compose.dev.yml restart
  python-consumer` from the repo root).

If this ever becomes a real friction point, the next step would be to add `watchdog`, force its
`PollingObserver` explicitly (not the CLI default), and verify it against a real Docker Desktop
bind mount the same way `--poll` was verified for Node — not to add it speculatively.

## Tests

Default - offline, no database required (matches Node's `npm test`):

```
pytest
```

`pytest.ini` sets `pythonpath = .`, so plain `pytest` and `python -m pytest`
behave identically; both are safe to use.

Full suite against a real test database (matches Node's `npm run test:db`):

```
TEST_DATABASE_URI=postgresql+psycopg://user:pass@localhost:5432/firewall_test pytest
```

Unit tests run entirely offline against monkeypatched environment variables -
no real PostgreSQL connection is made or required. PostgreSQL integration
tests additionally run when `TEST_DATABASE_URI` is set (see above); otherwise
they're skipped and the rest of the suite is unaffected. No committed
credential file is needed for either command, and neither reads the Node
service's `.env`/`.env.test`.

**A local `.env` does not affect unit tests.** `src/main/config.py` reads
`python-rule-service/.env` by default (so `python -m src.main` works without
manually exporting variables), and most config tests already build `Settings`
directly with `_env_file=None`, bypassing it entirely. One test
(`TestNoSecretLeakage`) instead calls the real `load_settings()` to verify its
error formatting, deleting `ENV` from the environment first - which meant a
real local `.env` with `ENV=dev` could silently refill that gap and defeat the
test. Fixed with `monkeypatch.setitem(Settings.model_config, "env_file",
None)`, scoped to that one test only (auto-reverted by pytest afterward) -
verified with a real `.env` present and absent, both ways passing.

## Architecture and Add IP trace

### Purpose

`python-rule-service` is an independent Python service that is now the sole writer of firewall
configuration changes made through `POST /api/firewall/ips`. Project 6 (#55-#61) built and proved
the write path **in isolation** - only through direct local calls, never through a live request.
Project 7 (#70-#75) connected it to real traffic: Node publishes a validated command to RabbitMQ,
and this service's consumer (see "RabbitMQ consumer (Project 7)" below) is what actually runs this
same trace for a real, live `POST /api/firewall/ips` request - verified end-to-end in Issue #75.
The trace itself (steps 2-10 below) is unchanged from Project 6; what changed is *what calls it*
in production - `CreateRulesCommandHandler` now, not just a test or a manual proof.

### What each layer owns

Dependencies point inward only - `main` and `adapters` may depend on
`application`, which may depend on `domain`; `domain` depends on nothing in
this service.

| Layer | Owns | Never imports |
|---|---|---|
| `src/main` | Composition root: validated config (`config.py`, #56, #70), the structured logger (`logger.py`, #57, #74), the SQLAlchemy `Engine` (`db.py`, #59), and the entry point (`__main__.py`) that wires the repository/use case/handler/consumer together and runs the long-lived process (#74) | - |
| `src/domain` | Framework-independent business rules: `RuleMode`, the self-validating `NewFirewallRule`/`FirewallRule`, `InvalidIpError` | `application/`, `adapters/`, Pydantic, SQLAlchemy, `structlog` - enforced by a source-scanning test, not just convention |
| `src/application` | `ApplicationError`, the one type a use case is allowed to raise outward | SQLAlchemy, `structlog` internals beyond calling the shared logger |
| `src/application/ports` | Abstract contracts a use case depends on (`RuleRepository`) - describes *what* must happen, never *how* | Any concrete adapter |
| `src/application/use_cases` | Orchestration (`AddIpUseCase`): builds the domain object, translates domain errors, calls the port, logs the outcome | SQLAlchemy directly - only ever the abstract port |
| `src/adapters/outbound/persistence/postgres` | The **only** place SQLAlchemy is imported anywhere in this service: `schema.py` (maps the existing `firewall_rules` table) and `sqlalchemy_rule_repository.py` (`SqlAlchemyRuleRepository`, the concrete `RuleRepository`) | `domain/` or `application/` never import back into this package |
| `src/adapters/inbound/rabbitmq` (Project 7, #73-#74) | The **only** place `aio_pika` is imported: `rabbitmq_consumer.py` (`RabbitMqCommandConsumer`), `message_models.py` (the Pydantic queue contract), and `create_rules_command_handler.py` (`CreateRulesCommandHandler`, calls `AddIpUseCase`) | `domain/` never imports this; `application/use_cases/add_ip_use_case.py` has no idea this package exists |

### Add IP trace - one insertion, entry point to database

1. A caller constructs `AddIpUseCase(repository)`. In production that
   `repository` is a `SqlAlchemyRuleRepository(engine)`, where `engine` is
   `main/db.py`'s SQLAlchemy `Engine`, built once from `settings.DATABASE_URI`
   (#56). As of Project 7, `__main__.py`'s `build_consumer()` performs exactly
   this construction automatically at startup - see "What `python -m src.main`
   does today" below, and "RabbitMQ consumer (Project 7)" for what calls
   `AddIpUseCase.execute()` in production (`CreateRulesCommandHandler`, not a
   generic "caller").
2. `AddIpUseCase.execute(mode, value)`
   (`application/use_cases/add_ip_use_case.py`) constructs a
   `NewFirewallRule(mode=mode, value=value)`.
3. `NewFirewallRule.__post_init__`
   (`domain/entities/firewall_rule.py`) validates `value` with Python's
   standard `ipaddress.IPv4Address` - IPv4 only. Invalid input raises the
   domain-owned `InvalidIpError` right there, in the domain layer, which never
   imports `ApplicationError`, SQLAlchemy, or the logger.
4. Back in the use case: an `InvalidIpError` is caught and translated into
   `ApplicationError(code="INVALID_IP", message=...)`; a `add_ip_rejected`
   event is logged and the repository is **never called**. Valid input
   continues to the next step.
5. The use case calls `self._repository.add(new_rule)` - typed only as the
   abstract `RuleRepository` port (`application/ports/rule_repository.py`).
   The use case has no idea it's talking to PostgreSQL.
6. `SqlAlchemyRuleRepository.add()`
   (`adapters/outbound/persistence/postgres/sqlalchemy_rule_repository.py`) -
   the concrete implementation actually invoked - builds one
   `INSERT ... RETURNING` statement against the `firewall_rules` `Table`
   mapping (`schema.py`: `type="ip"`, `mode`/`value` from the domain rule,
   `active=true`) and executes it inside `engine.begin()`.
7. The SQLAlchemy `Engine` opens the real connection and runs the statement
   against PostgreSQL.
8. PostgreSQL assigns the new row a real, database-generated `id` and returns
   it via `RETURNING`.
9. `SqlAlchemyRuleRepository` maps that row into a domain `FirewallRule`
   (`id`, `mode`, `value`, `active=True`) and returns it back up through the
   port to the use case, and from there to the original caller.
10. The use case logs one final structured event, `add_ip_succeeded`, with
    `mode` and the new `id` only - never a secret.

### Key distinctions

- **`NewFirewallRule` vs. `FirewallRule`** - `NewFirewallRule` is the
  pre-save input (`mode`, `value`; validates itself on construction, no
  `id`). `FirewallRule` is the post-save result (adds `id` and `active`,
  returned only by a repository after a successful write).
- **`RuleRepository` vs. `SqlAlchemyRuleRepository`** - `RuleRepository` is
  the abstract port (one method, `add()`, no implementation, no infrastructure
  knowledge). `SqlAlchemyRuleRepository` is its only concrete implementation
  and the only module in this entire service that imports SQLAlchemy.
- **Unit tests vs. PostgreSQL integration tests** - `tests/unit/` (55 tests)
  make zero network or database calls and always run. `tests/integration/`
  additionally opens a real PostgreSQL connection and only runs when
  `TEST_DATABASE_URI` is configured; otherwise those tests are skipped and the
  rest of the suite is unaffected.
- **`DATABASE_URI` vs. `TEST_DATABASE_URI`** - `DATABASE_URI` is this
  service's own application config, validated by `settings` (#56) and used by
  `main/db.py`'s engine (and, eventually, by `python -m src.main` if it ever
  wires up a real repository). `TEST_DATABASE_URI` is a completely separate
  variable read only by `tests/integration/db_test_helpers.py`, decoupled
  from `settings` entirely, and guarded to require a database name ending in
  `_test` - there is no code path by which a test could reach whatever
  database `DATABASE_URI` points at.
- **`.env.example` vs. `.env`** - `.env.example` is a safe, committed
  placeholder template (no real credentials). `.env` is the real, gitignored,
  local-only file a developer creates with `cp .env.example .env` and fills
  in themselves; it is never committed and this documentation never reads or
  prints its contents.

### Schema and migration ownership

**Drizzle remains the sole owner of the `firewall_rules` table's schema and
migrations.** This Python service never creates, alters, or migrates that
table - `schema.py` only maps it exactly as Drizzle already defines it
(`id`, `type`, `mode`, `value`, `active`, plus both `CHECK` constraints),
confirmed directly against the real database, not assumed (#59). No Alembic
or other Python migration tool exists in this service, and none is planned.

### What `python -m src.main` does today

**Updated for Project 7 (#74) - this section previously said the entry point did not wire up the
real Add IP flow. That is no longer true; corrected here rather than left stale.**

Running it loads and validates `settings` first (#56) - if that fails, the process stops before
the logger is even configured. If configuration is valid, it configures the logger (#57) and emits
one structured `service_startup` event (`env`/`configured_log_level`, never `DATABASE_URI`/
`CLOUDAMQP_URL`). It then **does** construct the real chain -
`SqlAlchemyRuleRepository(engine)` → `AddIpUseCase(repository)` →
`CreateRulesCommandHandler(add_ip_use_case)` → `RabbitMqCommandConsumer(...)` (`build_consumer()`
in `__main__.py`) - and starts the consumer, which processes real messages from RabbitMQ and does
insert database rows automatically, for as long as the process keeps running. See "RabbitMQ
consumer (Project 7)" below for the full trace from queue message to database row, and "Run" above
for the lifecycle (it no longer exits after the startup log line).

### Node.js vs. Python - what moved, what didn't

**Updated for Project 7 (#70-#75) - this section previously described Project 6's isolated-proof
state, where nothing here was reachable from real traffic. That has changed for one route; the
rest of the split still holds.**

- **Still entirely in Node.js, unchanged:** HTTP routing (the Express app and all
  `/api/firewall/*` endpoints), request validation at the HTTP boundary, authentication (none
  currently exists, and that hasn't changed), and the direct database writes for `/domains` and
  `/ports` (and `GET`/`DELETE`/`PATCH`) - those routes are unaffected by Project 7 and still write
  to PostgreSQL from Node exactly as before.
- **Moved to Python, and now live in production traffic (Project 7):** for `POST
  /api/firewall/ips` specifically - Add IP domain validation, the `AddIpUseCase` orchestration, and
  the actual `firewall_rules` write via `SqlAlchemyRuleRepository`. Node validates the HTTP request
  and publishes a command; this service is what actually persists it, reached via a real RabbitMQ
  message, not just direct local calls or a manual proof any more. See "RabbitMQ consumer (Project
  7)" below.
- **Still not implemented, by explicit scope choice (not "not yet designed"):** retry/backoff for
  failed consumer processing, a requeue strategy, and idempotency/duplicate protection. See
  "Known limitations" in the root `README.md`'s Project 7 section.

## RabbitMQ consumer (Project 7)

This service's inbound half of Project 7's asynchronous flow. For the full two-service picture
(Node's publisher side, the message contract, the architecture diagram), see the root
`README.md`'s "Project 7: asynchronous command flow" section - this section covers only the
Python-side components.

| Component | File | Responsibility |
|---|---|---|
| `RabbitMqCommandConsumer` | `src/adapters/inbound/rabbitmq/rabbitmq_consumer.py` | Connects via `aio-pika` (`aio_pika.connect_robust`, injectable for tests), opens one channel, does a *passive* check that `RABBITMQ_QUEUE` already exists (never creates one), and registers a consumer callback. Decides ack/reject - the only file that knows about `aio_pika` types |
| Message models | `src/adapters/inbound/rabbitmq/message_models.py` | Pydantic `CreateRulesCommand`/`CreateRulesPayload` - validates the untrusted queue payload before anything touches application code, exactly as `ruleValidation.ts` validates Node's HTTP boundary |
| `CreateRulesCommandHandler` | `src/adapters/inbound/rabbitmq/create_rules_command_handler.py` | The real implementation of the consumer's handler seam. For each value in the command's payload, calls the existing, unmodified `AddIpUseCase.execute(mode, value)` via `asyncio.to_thread()` (since that use case and `SqlAlchemyRuleRepository` are synchronous, blocking code - running them in a worker thread keeps the consumer's event loop unblocked). Binds `operation_id` into `structlog.contextvars` for the duration, so it's automatically included in every log line emitted while processing - including `AddIpUseCase`'s own pre-existing `add_ip_succeeded`/`add_ip_rejected` lines, with zero changes to that file |
| `__main__.py` | `src/main/__main__.py` | The composition root: `build_consumer()` wires the four objects above together; `run()` starts the consumer, waits for a shutdown signal, then stops it gracefully; `main()` is the thin process entry point |

**ACK/reject behavior** (mirrors the root README's table exactly): a message that fails JSON
parsing or the Pydantic contract is `reject(requeue=False)`ed and never reaches the handler; a
message whose handler raises (e.g. the database write fails) is also `reject(requeue=False)`ed,
never acked as successful; a message is only `ack()`ed once `AddIpUseCase`/
`SqlAlchemyRuleRepository` return successfully. Failures are not requeued, deliberately - an
unbounded retry loop with no backoff would hammer a persistently failing dependency forever;
redelivery/retry/idempotency are out of scope for this phase, not an oversight.

**Verified end-to-end (Issue #75):** one real `POST /api/firewall/ips` request was traced through
this exact path against the real CloudAMQP instance and local PostgreSQL - `create_rules_command_received`
→ `add_ip_succeeded` → `create_rules_command_processed`, all carrying the same `operation_id` as
Node's HTTP response, with the resulting row confirmed in PostgreSQL. Full debugging narrative
(a local `.env` configuration issue, not a code defect, was found and fixed along the way) is in
`AI_CONVERSATION_REPORT.md`.
