import json
from collections.abc import Awaitable, Callable
from unittest.mock import AsyncMock

import pytest

from src.adapters.inbound.rabbitmq.message_models import CreateRulesCommand
from src.adapters.inbound.rabbitmq.rabbitmq_consumer import RabbitMqCommandConsumer

VALID_BODY = json.dumps(
    {
        "operation_id": "11111111-1111-1111-1111-111111111111",
        "command_type": "create_rules",
        "payload": {"type": "ip", "mode": "blacklist", "values": ["1.2.3.4"]},
    }
).encode("utf-8")


class FakeIncomingMessage:
    def __init__(self, body: bytes) -> None:
        self.body = body
        self.ack_calls = 0
        self.reject_calls: list[bool] = []

    async def ack(self, multiple: bool = False) -> None:
        self.ack_calls += 1

    async def reject(self, requeue: bool = False) -> None:
        self.reject_calls.append(requeue)


class FakeQueue:
    def __init__(self, name: str) -> None:
        self.name = name
        self.consumed_callback: Callable[[FakeIncomingMessage], Awaitable[None]] | None = None

    async def consume(self, callback: Callable[[FakeIncomingMessage], Awaitable[None]]) -> None:
        self.consumed_callback = callback


class FakeChannel:
    def __init__(self) -> None:
        self.get_queue_calls: list[str] = []
        self.queue = FakeQueue("unset")
        self.close_calls = 0

    async def get_queue(self, name: str, **kwargs: object) -> FakeQueue:
        self.get_queue_calls.append(name)
        self.queue = FakeQueue(name)
        return self.queue

    async def close(self) -> None:
        self.close_calls += 1


class FakeConnection:
    def __init__(self) -> None:
        self.channel_calls = 0
        self.fake_channel = FakeChannel()
        self.close_calls = 0

    async def channel(self) -> FakeChannel:
        self.channel_calls += 1
        return self.fake_channel

    async def close(self) -> None:
        self.close_calls += 1


def build_consumer(
    handler: Callable[[CreateRulesCommand], Awaitable[None]] | None = None,
) -> tuple[RabbitMqCommandConsumer, list[str], FakeConnection]:
    connect_urls: list[str] = []
    connection = FakeConnection()

    async def fake_connect(url: str) -> FakeConnection:
        connect_urls.append(url)
        return connection

    consumer = RabbitMqCommandConsumer(
        url="amqps://user:pass@host/vhost",
        queue_name="romi.firewall.commands",
        handler=handler or AsyncMock(),
        connect=fake_connect,  # type: ignore[arg-type]
    )
    return consumer, connect_urls, connection


class TestStart:
    async def test_connects_using_the_configured_url(self) -> None:
        consumer, connect_urls, _connection = build_consumer()

        await consumer.start()

        assert connect_urls == ["amqps://user:pass@host/vhost"]

    async def test_opens_exactly_one_channel(self) -> None:
        consumer, _urls, connection = build_consumer()

        await consumer.start()

        assert connection.channel_calls == 1

    async def test_consumes_from_the_configured_queue(self) -> None:
        consumer, _urls, connection = build_consumer()

        await consumer.start()

        assert connection.fake_channel.get_queue_calls == ["romi.firewall.commands"]

    async def test_registers_a_consumer_callback_on_the_queue(self) -> None:
        consumer, _urls, connection = build_consumer()

        await consumer.start()

        assert connection.fake_channel.queue.consumed_callback is not None


class TestValidMessage:
    async def test_handler_receives_a_parsed_create_rules_command(self) -> None:
        handler = AsyncMock()
        consumer, _urls, connection = build_consumer(handler=handler)
        await consumer.start()
        message = FakeIncomingMessage(VALID_BODY)

        await connection.fake_channel.queue.consumed_callback(message)

        handler.assert_awaited_once()
        received = handler.await_args.args[0]
        assert isinstance(received, CreateRulesCommand)
        assert received.operation_id == "11111111-1111-1111-1111-111111111111"
        assert received.payload.values == ["1.2.3.4"]

    async def test_acks_after_the_handler_is_called(self) -> None:
        consumer, _urls, connection = build_consumer()
        await consumer.start()
        message = FakeIncomingMessage(VALID_BODY)

        await connection.fake_channel.queue.consumed_callback(message)

        assert message.ack_calls == 1
        assert message.reject_calls == []


class TestInvalidMessages:
    async def test_invalid_json_is_rejected_without_requeue_and_handler_is_not_called(self) -> None:
        handler = AsyncMock()
        consumer, _urls, connection = build_consumer(handler=handler)
        await consumer.start()
        message = FakeIncomingMessage(b"{not valid json")

        await connection.fake_channel.queue.consumed_callback(message)

        handler.assert_not_awaited()
        assert message.reject_calls == [False]
        assert message.ack_calls == 0

    async def test_wrong_command_type_is_rejected_and_handler_is_not_called(self) -> None:
        handler = AsyncMock()
        consumer, _urls, connection = build_consumer(handler=handler)
        await consumer.start()
        body = json.dumps(
            {
                "operation_id": "11111111-1111-1111-1111-111111111111",
                "command_type": "delete_rules",
                "payload": {"type": "ip", "mode": "blacklist", "values": ["1.2.3.4"]},
            }
        ).encode("utf-8")
        message = FakeIncomingMessage(body)

        await connection.fake_channel.queue.consumed_callback(message)

        handler.assert_not_awaited()
        assert message.reject_calls == [False]

    async def test_wrong_payload_type_is_rejected_and_handler_is_not_called(self) -> None:
        handler = AsyncMock()
        consumer, _urls, connection = build_consumer(handler=handler)
        await consumer.start()
        body = json.dumps(
            {
                "operation_id": "11111111-1111-1111-1111-111111111111",
                "command_type": "create_rules",
                "payload": {"type": "domain", "mode": "blacklist", "values": ["1.2.3.4"]},
            }
        ).encode("utf-8")
        message = FakeIncomingMessage(body)

        await connection.fake_channel.queue.consumed_callback(message)

        handler.assert_not_awaited()
        assert message.reject_calls == [False]

    async def test_invalid_mode_is_rejected_and_handler_is_not_called(self) -> None:
        handler = AsyncMock()
        consumer, _urls, connection = build_consumer(handler=handler)
        await consumer.start()
        body = json.dumps(
            {
                "operation_id": "11111111-1111-1111-1111-111111111111",
                "command_type": "create_rules",
                "payload": {"type": "ip", "mode": "allow", "values": ["1.2.3.4"]},
            }
        ).encode("utf-8")
        message = FakeIncomingMessage(body)

        await connection.fake_channel.queue.consumed_callback(message)

        handler.assert_not_awaited()
        assert message.reject_calls == [False]

    async def test_empty_values_is_rejected_and_handler_is_not_called(self) -> None:
        handler = AsyncMock()
        consumer, _urls, connection = build_consumer(handler=handler)
        await consumer.start()
        body = json.dumps(
            {
                "operation_id": "11111111-1111-1111-1111-111111111111",
                "command_type": "create_rules",
                "payload": {"type": "ip", "mode": "blacklist", "values": []},
            }
        ).encode("utf-8")
        message = FakeIncomingMessage(body)

        await connection.fake_channel.queue.consumed_callback(message)

        handler.assert_not_awaited()
        assert message.reject_calls == [False]

    async def test_invalid_ipv4_is_rejected_and_handler_is_not_called(self) -> None:
        handler = AsyncMock()
        consumer, _urls, connection = build_consumer(handler=handler)
        await consumer.start()
        body = json.dumps(
            {
                "operation_id": "11111111-1111-1111-1111-111111111111",
                "command_type": "create_rules",
                "payload": {"type": "ip", "mode": "blacklist", "values": ["999.999.999.999"]},
            }
        ).encode("utf-8")
        message = FakeIncomingMessage(body)

        await connection.fake_channel.queue.consumed_callback(message)

        handler.assert_not_awaited()
        assert message.reject_calls == [False]


class TestStop:
    async def test_closes_the_channel_and_connection(self) -> None:
        consumer, _urls, connection = build_consumer()
        await consumer.start()

        await consumer.stop()

        assert connection.fake_channel.close_calls == 1
        assert connection.close_calls == 1

    async def test_is_safe_to_call_when_never_started(self) -> None:
        consumer, _urls, _connection = build_consumer()

        await consumer.stop()
