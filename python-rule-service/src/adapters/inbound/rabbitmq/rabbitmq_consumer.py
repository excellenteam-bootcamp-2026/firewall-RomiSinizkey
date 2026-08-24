import json
from collections.abc import Awaitable, Callable

import aio_pika
from pydantic import ValidationError

from src.adapters.inbound.rabbitmq.message_models import CreateRulesCommand
from src.main.logger import logger

# The handler seam - receives an already-validated command and runs the
# create-rules use case against PostgreSQL. See
# src/adapters/inbound/rabbitmq/create_rules_command_handler.py for the real
# implementation wired in by src/main/__main__.py.
CommandHandler = Callable[[CreateRulesCommand], Awaitable[None]]

# Injectable so tests never need a real CloudAMQP connection - defaults to the
# real aio_pika connector for production use.
ConnectFn = Callable[[str], Awaitable["aio_pika.abc.AbstractRobustConnection"]]


class RabbitMqCommandConsumer:
    """Inbound RabbitMQ adapter.

    Consumes from the configured queue, validates each message against the
    ``CreateRulesCommand`` contract (``message_models.py``), and calls an
    injected async handler with the validated command. No ``aio_pika`` type
    is exposed outside this module - the handler seam only ever receives the
    Pydantic ``CreateRulesCommand``.

    Constructed from an explicit ``url``/``queue_name`` (not by importing
    ``settings`` itself), so it can be unit-tested without real config or a
    network connection. ``src/main/__main__.py`` constructs this from
    ``settings.CLOUDAMQP_URL`` / ``settings.RABBITMQ_QUEUE``.

    ACK/NACK behavior (Issue #74 - final for this phase):

    - Message fails to parse as JSON, or fails the Pydantic contract ->
      ``reject(requeue=False)``. Never reaches the handler.
    - Handler raises (e.g. the database write fails) -> ``reject(requeue=False)``.
      Not acked as successful.
    - Handler completes without raising -> ``ack()``. This is the only case
      that acks - i.e. only after ``AddIpUseCase``/``SqlAlchemyRuleRepository``
      have actually written the row (Issue #74's ``CreateRulesCommandHandler`` -
      not this module - is what makes the handler synchronous with the DB write).

    Deliberately not requeuing on handler failure: a persistent failure (e.g.
    the database being down) requeued with no backoff would redeliver the
    same message in a tight loop, hammering the broker and the database
    forever. Exercise 7's own materials explicitly defer "the detailed
    behavior of acknowledgements and redelivery" to a later phase - retry
    with backoff and any redelivery/idempotency strategy are out of scope
    here, not silently forgotten.
    """

    def __init__(
        self,
        url: str,
        queue_name: str,
        handler: CommandHandler,
        connect: ConnectFn = aio_pika.connect_robust,
    ) -> None:
        self._url = url
        self._queue_name = queue_name
        self._handler = handler
        self._connect = connect
        self._connection: aio_pika.abc.AbstractRobustConnection | None = None
        self._channel: aio_pika.abc.AbstractChannel | None = None

    async def start(self) -> None:
        self._connection = await self._connect(self._url)
        self._channel = await self._connection.channel()
        # ensure=True (the default) performs a passive check that the queue
        # already exists - it never creates one (Issue #70 already did).
        queue = await self._channel.get_queue(self._queue_name)
        await queue.consume(self._on_message)

    async def stop(self) -> None:
        if self._channel is not None:
            await self._channel.close()
        if self._connection is not None:
            await self._connection.close()
        self._channel = None
        self._connection = None

    async def _on_message(self, message: "aio_pika.abc.AbstractIncomingMessage") -> None:
        command = self._parse(message.body)
        if command is None:
            await message.reject(requeue=False)
            return

        try:
            await self._handler(command)
        except Exception:
            logger.error("rabbitmq_message_handler_failed", operation_id=command.operation_id)
            await message.reject(requeue=False)
            return

        await message.ack()

    def _parse(self, body: bytes) -> CreateRulesCommand | None:
        try:
            raw = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            logger.warning("rabbitmq_message_invalid_json")
            return None

        try:
            return CreateRulesCommand.model_validate(raw)
        except ValidationError as exc:
            logger.warning("rabbitmq_message_invalid_contract", errors=exc.errors())
            return None
