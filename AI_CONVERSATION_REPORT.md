# AI Conversation Report — Issue #57

## Purpose

This report covers only the current branch's issue. Earlier issues' summaries were removed by
request; their full history remains available via `git log` on `main`, where each was committed
when its PR merged. No secrets, passwords, credentials, or environment-variable values appear
below.

## Issue #57: Add structured logging and application errors

**Objective:** add centralized structured logging (`structlog`) and a small reusable
`ApplicationError(code, message)` type to `python-rule-service`, configured from the already
validated Pydantic settings (Issue #56). No IP domain logic or SQLAlchemy — deferred to Issues
#58/#59.

**Key decisions and explanations:**
- `src/main/logger.py` configures `structlog` exactly once, at import time, from
  `settings.ENV`/`settings.LOG_LEVEL`. Development renders colorized console output; production
  renders one JSON object per line — the same environment-driven split Node's Winston logger makes,
  adapted to `structlog`'s own idiom rather than ported line-by-line.
- `ApplicationError` carries only `code` and `message`, nothing else — its `str()`/`repr()`/
  `to_dict()` can never expose more than what a caller explicitly provides. Mirrors Node's
  `AppError`, minus `statusCode`, since this service has no inbound HTTP adapter yet.
- Added `tests/conftest.py` (`os.environ.setdefault(...)`) so any test module that transitively
  imports `config.py` gets a safe baseline at collection time, regardless of run order — needed
  because this issue added two more files with that same transitive dependency, and relying on
  `test_config.py` happening to run first (as in #56) was already fragile.
- Found and fixed a real bug via the tests: a custom log field named `log_level` silently collided
  with `structlog`'s own built-in severity key of the same name and was overwritten. Renamed to
  `configured_log_level`.

**Files changed:**
- `python-rule-service/requirements.txt` (+`structlog`)
- `python-rule-service/src/main/logger.py` (new)
- `python-rule-service/src/application/errors.py` (new)
- `python-rule-service/src/main/__main__.py` (loads settings → configures logger → emits one
  `service_startup` event; no more `print()`)
- `python-rule-service/tests/conftest.py` (new)
- `python-rule-service/tests/unit/main/test_logger.py`,
  `python-rule-service/tests/unit/main/test_main.py`,
  `python-rule-service/tests/unit/application/test_errors.py` (new, 15 tests total)
- `python-rule-service/README.md` (new Logging and Application errors sections)

**Implementation summary:** `__main__.py` imports `settings` (fails fast on bad configuration, per
#56) first, then `logger`, then logs one structured `service_startup` event with `env` and
`configured_log_level` — never `DATABASE_URI`. Verified two independent ways that no secret can
reach the logs: behaviorally (the captured startup event is asserted secret-free) and statically
(the entry point's own source is scanned for the literal string `DATABASE_URI` and for `print(`).

**Verification commands and results:**
```
python -m pytest   → 28 passed (13 from #56, unchanged + 15 new), run from python-rule-service/
npm run lint        → passed
npm run build       → passed
npm test             → 178 passed, 17 skipped, 0 failed
```
Manual: valid `ENV=dev` config → colorized console startup event; valid `ENV=production` config →
one JSON startup event; missing `DATABASE_URI` → exit 1, raised before the logger is even
configured. No `.env` file was created or committed at any point.

**Unresolved problems / known limitations:**
- No RabbitMQ-style `operation_id` tracing — explicitly deferred to Project 7.
- `ApplicationError` is not yet raised anywhere in real application logic (no domain/use-case
  wiring exists yet) — that arrives in Issue #58.
- Logging has only been exercised via local manual runs and unit tests, not inside a real
  container or production deployment.

Nothing was staged, committed, pushed, or changed on GitHub for this work.
