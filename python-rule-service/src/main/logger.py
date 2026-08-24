import logging
import sys

import structlog

from src.main.config import settings

_processors: list[structlog.types.Processor] = [
    # Merges any context bound via structlog.contextvars.bind_contextvars()
    # (e.g. operation_id) into every log call made while that context is
    # active - including calls from modules that only ever import the plain
    # `logger` below, with no changes required in those modules themselves.
    structlog.contextvars.merge_contextvars,
    structlog.processors.add_log_level,
    structlog.processors.TimeStamper(fmt="iso"),
]
_processors.append(structlog.dev.ConsoleRenderer() if settings.ENV == "dev" else structlog.processors.JSONRenderer())

structlog.configure(
    processors=_processors,
    wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, settings.LOG_LEVEL)),
    logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger("python-rule-service")
