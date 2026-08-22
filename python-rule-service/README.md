# python-rule-service

Independent Python service that will eventually become the sole writer of firewall
configuration changes (Epic #54, `Project6-Dockerization-Plan.pdf`). Issue #55 stood
up the environment and the hexagonal folder skeleton; Issue #56 added validated
startup configuration; Issue #57 added structured logging and a reusable application
error type; Issue #58 added the first business operation - Add IP - as a domain
model, an application use case, and a repository port; Issue #59 added the concrete
SQLAlchemy/PostgreSQL implementation of that port, reusing the existing
`firewall_rules` table; Issue #60 consolidates the pytest suite, adds an
end-to-end integration test through the real database, and fixes a
`pythonpath`/collection gap and a local-`.env` test-isolation bug. The existing
Node.js API is unchanged and keeps serving all traffic; no schema, migration,
HTTP, or Docker changes were made.

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
    schema.py                      firewall_rules Table mapping (this issue, #59)
    sqlalchemy_rule_repository.py  SqlAlchemyRuleRepository (this issue, #59)
  main/
    config.py                      validated Pydantic settings (#56)
    logger.py                      configured structlog logger (#57)
    db.py                          SQLAlchemy Engine built from DATABASE_URI (this issue, #59)
    __main__.py                    entry point - loads settings, logs a startup event
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
  unit/conftest.py                shared FakeRuleRepository fixture (this issue, #60)
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

## Configuration

Copy the placeholder template and fill in real local values - `.env` is gitignored,
`.env.example` is not:

```
cp .env.example .env
```

Three variables, validated once at startup by `src/main/config.py` via Pydantic /
pydantic-settings, and exported as a single immutable `settings` object. Nothing
else in the service reads `os.environ` directly.

| Variable       | Validation                                                                 |
|----------------|-----------------------------------------------------------------------------|
| `ENV`          | must be exactly `dev` or `production`                                       |
| `DATABASE_URI` | required, non-blank PostgreSQL connection string                            |
| `LOG_LEVEL`    | must be one of `DEBUG`/`INFO`/`WARNING`/`ERROR`/`CRITICAL` (case-insensitive, normalized to uppercase) |

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

Loads and validates settings first (#56); if that fails, the process stops
before the logger is even configured. If configuration is valid, the logger is
configured and the entry point emits one structured `service_startup` event
with `env` and `configured_log_level` (never `DATABASE_URI`), then exits 0.

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

Full architecture documentation lands in Issue #61.
