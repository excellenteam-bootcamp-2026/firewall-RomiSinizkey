# syntax=docker/dockerfile:1

# ---- development: runs the long-lived RabbitMQ consumer, code bind-mounted -----
# Intended to run with python-rule-service/ bind-mounted over /app (the root
# docker-compose.dev.yml's `python-consumer` service), so edits on the host are
# visible inside the container without a rebuild. No database or CloudAMQP
# credentials are baked into the image — they arrive at container-start time
# via env_file (python-rule-service/.env.dev), never committed.
#
# Linux base (not Windows) so psycopg[binary]'s manylinux wheel applies cleanly
# and this image behaves the same on every host OS, matching how the root
# Dockerfile's Node images are also always Linux regardless of host.
FROM python:3.13-slim AS development
WORKDIR /app

# PYTHONUNBUFFERED: structlog output is flushed immediately instead of being
# stdout-buffered, so `docker compose logs -f` shows log lines as they happen.
# PYTHONDONTWRITEBYTECODE: skips writing __pycache__/*.pyc back through the
# bind mount onto the host.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Copied and installed separately from the rest of the source so this layer
# only rebuilds when requirements.txt actually changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "-m", "src.main"]
