# python-rule-service

Independent Python service that will eventually become the sole writer of firewall
configuration changes (Epic #54, `Project6-Dockerization-Plan.pdf`). Issue #55 stood
up the environment and the hexagonal folder skeleton; Issue #56 added validated
startup configuration; Issue #57 added structured logging and a reusable application
error type; Issue #58 adds the first business operation - Add IP - as a domain
model, an application use case, and a repository port. Database code is still to
come (#59-#61). The existing Node.js API is unchanged and keeps serving all traffic.

## Structure

```
src/
  domain/
    entities/firewall_rule.py      RuleMode, NewFirewallRule (self-validating), FirewallRule (this issue, #58)
    errors.py                      InvalidIpError (this issue, #58)
  application/
    errors.py                      ApplicationError(code, message) (#57)
    ports/rule_repository.py       RuleRepository (abstract, add() only) (this issue, #58)
    use_cases/add_ip_use_case.py   AddIpUseCase (this issue, #58)
  adapters/outbound/persistence/   SQLAlchemy repository (arrives in #59)
  main/
    config.py                      validated Pydantic settings (#56)
    logger.py                      configured structlog logger (#57)
    __main__.py                    entry point - loads settings, logs a startup event
tests/
  unit/main/test_config.py                     config validation tests (#56)
  unit/main/test_logger.py                     structured output + level filtering (#57)
  unit/main/test_main.py                       entry-point startup event tests (#57)
  unit/application/test_errors.py              ApplicationError tests (#57)
  unit/domain/entities/test_firewall_rule.py   IPv4 validation + domain purity (this issue, #58)
  unit/domain/test_errors.py                   InvalidIpError tests (this issue, #58)
  unit/application/ports/test_rule_repository.py    port contract tests (this issue, #58)
  unit/application/use_cases/test_add_ip_use_case.py  AddIpUseCase tests (this issue, #58)
  conftest.py                      safe baseline env, so config-dependent test
                                    modules collect regardless of run order
  integration/
  fixtures/
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

This issue only validates configuration shape; no database connection is opened
here (that's #59).

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
  full four-method interface. No concrete (e.g. SQLAlchemy) implementation exists
  yet; that's Issue #59.
- **Use case** (`src/application/use_cases/add_ip_use_case.py`): `AddIpUseCase`
  constructs a `NewFirewallRule` (which validates itself); if that raises
  `InvalidIpError`, the use case - not the domain - catches it and raises
  `ApplicationError(code="INVALID_IP", message=...)` instead, then returns
  without ever calling the repository. On success, it calls
  `repository.add(...)` once and returns exactly what the repository returns.
  Logs one structured event either way (`add_ip_rejected` or
  `add_ip_succeeded`) via the Issue #57 logger - `mode` and the rule's `id`/IP
  value only, never a secret.

## Run

```
python -m src.main
```

Loads and validates settings first (#56); if that fails, the process stops
before the logger is even configured. If configuration is valid, the logger is
configured and the entry point emits one structured `service_startup` event
with `env` and `configured_log_level` (never `DATABASE_URI`), then exits 0.

## Tests

```
python -m pytest
```

Runs entirely offline against monkeypatched environment variables - no real
PostgreSQL connection is made or required.

Full architecture documentation lands in Issue #61.
