# python-rule-service

Independent Python service that will eventually become the sole writer of firewall
configuration changes (Epic #54, `Project6-Dockerization-Plan.pdf`). Issue #55 stood
up the environment and the hexagonal folder skeleton; Issue #56 adds validated
startup configuration. Logging, domain logic, and database code are still to come
(#57-#61). The existing Node.js API is unchanged and keeps serving all traffic.

## Structure

```
src/
  domain/                          business rules (arrives in #58)
  application/                     use cases + repository port (arrives in #58)
  adapters/outbound/persistence/   SQLAlchemy repository (arrives in #59)
  main/
    config.py                      validated Pydantic settings (this issue, #56)
    __main__.py                    entry point - loads settings, prints a status line
tests/
  unit/main/test_config.py         config validation tests (this issue, #56)
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

## Run

```
python -m src.main
```

With a valid `.env`/environment, prints `ENV` and `LOG_LEVEL` (never
`DATABASE_URI`) confirming configuration loaded successfully. With missing or
invalid configuration, exits with a non-zero status and the validation error
described above - no other startup work happens first.

## Tests

```
python -m pytest
```

Runs entirely offline against monkeypatched environment variables - no real
PostgreSQL connection is made or required.

Full architecture documentation lands in Issue #61.
