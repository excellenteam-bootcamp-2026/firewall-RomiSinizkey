import asyncio
import signal

from src.adapters.inbound.rabbitmq.create_rules_command_handler import CreateRulesCommandHandler
from src.adapters.inbound.rabbitmq.rabbitmq_consumer import RabbitMqCommandConsumer
from src.adapters.outbound.persistence.postgres.sqlalchemy_rule_repository import SqlAlchemyRuleRepository
from src.application.use_cases.add_ip_use_case import AddIpUseCase
from src.main.config import settings
from src.main.db import engine
from src.main.logger import logger


def build_consumer() -> RabbitMqCommandConsumer:
    """Wires the real runtime path: SqlAlchemyRuleRepository -> AddIpUseCase ->
    CreateRulesCommandHandler -> RabbitMqCommandConsumer, using the existing
    module-level `engine` (src/main/db.py) and validated `settings`."""
    repository = SqlAlchemyRuleRepository(engine)
    add_ip_use_case = AddIpUseCase(repository)
    handler = CreateRulesCommandHandler(add_ip_use_case)
    return RabbitMqCommandConsumer(
        url=settings.CLOUDAMQP_URL,
        queue_name=settings.RABBITMQ_QUEUE,
        handler=handler,
    )


async def run(consumer: RabbitMqCommandConsumer, stop_event: asyncio.Event | None = None) -> None:
    """Starts `consumer`, remains alive until `stop_event` is set (by a
    SIGINT/SIGTERM handler installed here, or injected directly by a test),
    then stops it gracefully. Takes an already-built consumer so it can be
    exercised in tests without a real broker connection or real signals."""
    if stop_event is None:
        stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()

    def _request_stop(*_args: object) -> None:
        loop.call_soon_threadsafe(stop_event.set)

    installed_via_loop: list[signal.Signals] = []
    previous_handlers: dict[signal.Signals, object] = {}

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
            installed_via_loop.append(sig)
        except NotImplementedError:
            # add_signal_handler isn't supported on Windows' default event
            # loop; signal.signal() is the cross-platform fallback.
            previous_handlers[sig] = signal.signal(sig, _request_stop)

    try:
        await consumer.start()
        logger.info("rabbitmq_consumer_started", queue=settings.RABBITMQ_QUEUE)

        await stop_event.wait()

        logger.info("service_shutdown_started")
        await consumer.stop()
        logger.info("service_shutdown_complete")
    finally:
        # Never leave this process's global signal handlers pointed at a
        # stop_event/consumer that no longer exists once run() returns.
        for sig in installed_via_loop:
            loop.remove_signal_handler(sig)
        for sig, previous in previous_handlers.items():
            signal.signal(sig, previous)


def main() -> None:
    logger.info("service_startup", env=settings.ENV, configured_log_level=settings.LOG_LEVEL)
    consumer = build_consumer()
    asyncio.run(run(consumer))


if __name__ == "__main__":
    main()
