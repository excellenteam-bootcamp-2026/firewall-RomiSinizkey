import logging
import sys

import structlog

from src.main.config import settings

_processors: list[structlog.types.Processor] = [
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
