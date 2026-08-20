# python-rule-service

Independent Python service that will eventually become the sole writer of firewall
configuration changes (Epic #54, `Project6-Dockerization-Plan.pdf`). This issue
(#55) only stands up the environment and the hexagonal folder skeleton - no
configuration, logging, domain logic, or database code yet (that's #56-#61).
The existing Node.js API is unchanged and keeps serving all traffic.

## Structure

```
src/
  domain/                          business rules (arrives in #58)
  application/                     use cases + repository port (arrives in #58)
  adapters/outbound/persistence/   SQLAlchemy repository (arrives in #59)
  main/                            settings, logging, wiring (arrives in #56, #57)
tests/
  unit/
  integration/
  fixtures/
```

## Setup

```
cd python-rule-service
py -3.13 -m venv .venv        # Windows; use `python3.11+ -m venv .venv` elsewhere
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # macOS/Linux
pip install -r requirements.txt   # currently empty
```

## Run

```
python -m src.main
```

Prints a one-line confirmation that the skeleton and virtual environment work.
No business logic runs yet.

Full architecture documentation lands in Issue #61.
