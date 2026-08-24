import asyncio

import structlog

from src.adapters.inbound.rabbitmq.message_models import CreateRulesCommand
from src.application.use_cases.add_ip_use_case import AddIpUseCase
from src.main.logger import logger


class CreateRulesCommandHandler:
    """Translates a validated ``CreateRulesCommand`` into ``AddIpUseCase`` calls.

    This is the handler seam ``RabbitMqCommandConsumer`` was built against in
    Issue #73. ``command_type`` is already guaranteed ``"create_rules"`` and
    ``payload.type`` is already guaranteed ``"ip"`` by ``CreateRulesCommand``'s
    own Pydantic validation - this handler does not re-validate either.

    ``AddIpUseCase.execute()`` is synchronous, existing, unmodified code
    (Issue #74 explicitly reuses it and ``SqlAlchemyRuleRepository` rather
    than building a second persistence path). Each call runs in a worker
    thread via ``asyncio.to_thread`` so the blocking PostgreSQL write never
    blocks the consumer's event loop; ``asyncio.to_thread`` propagates the
    current context, so the ``operation_id`` bound below still reaches
    ``AddIpUseCase``'s own log lines even though they run on that thread.
    """

    def __init__(self, add_ip_use_case: AddIpUseCase) -> None:
        self._add_ip_use_case = add_ip_use_case

    async def __call__(self, command: CreateRulesCommand) -> None:
        structlog.contextvars.bind_contextvars(operation_id=command.operation_id)
        try:
            logger.info("create_rules_command_received", value_count=len(command.payload.values))
            for value in command.payload.values:
                await asyncio.to_thread(self._add_ip_use_case.execute, command.payload.mode, value)
            logger.info("create_rules_command_processed")
        finally:
            structlog.contextvars.unbind_contextvars("operation_id")
