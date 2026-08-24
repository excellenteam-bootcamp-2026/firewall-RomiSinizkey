import json
from collections.abc import Awaitable, Callable

import aio_pika
from pydantic import ValidationError

from src.adapters.inbound.rabbitmq.message_models import CreateRulesCommand
from src.main.logger import logger

# The handler seam Issue #74 will implement - it receives an already-validated
# command and is expected to run the create-rules use case against PostgreSQL.
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
    network connection. Issue #74's entrypoint wiring is expected to
    construct this from ``settings.CLOUDAMQP_URL`` / ``settings.RABBITMQ_QUEUE``.

    Issue #73 scope only: ack/reject here covers the *validation* boundary -
    a message that fails to parse as JSON or fails the Pydantic contract is
    rejected (not requeued) and never reaches the handler. A message that
    passes validation is acked once the handler has been *called*. This is
    NOT the final "ack only after the database write succeeds" semantics,
    and nothing here decides what happens if the handler itself raises -
    both belong to Issue #74.
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

        await self._handler(command)
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
