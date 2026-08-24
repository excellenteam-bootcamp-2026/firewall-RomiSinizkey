import asyncio
import signal
from pathlib import Path

import pytest
from structlog.testing import capture_logs

from src.main import __main__ as main_module
from src.main.config import settings


class FakeConsumer:
    def __init__(self) -> None:
        self.start_calls = 0
        self.stop_calls = 0

    async def start(self) -> None:
        self.start_calls += 1

    async def stop(self) -> None:
        self.stop_calls += 1


class TestStartupEvent:
    def test_main_emits_a_service_startup_event_with_only_safe_fields(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # main() must not actually start a real consumer in this test - only
        # prove the startup log line and that it hands off to build_consumer/run.
        monkeypatch.setattr(main_module, "build_consumer", lambda: "fake-consumer")
        run_calls: list[object] = []

        async def fake_run(consumer: object) -> None:
            run_calls.append(consumer)

        monkeypatch.setattr(main_module, "run", fake_run)

        with capture_logs() as captured:
            main_module.main()

        startup_events = [e for e in captured if e["event"] == "service_startup"]
        assert len(startup_events) == 1
        event = startup_events[0]
        assert event["env"] == settings.ENV
        assert event["configured_log_level"] == settings.LOG_LEVEL
        assert "database_uri" not in event
        assert settings.DATABASE_URI not in repr(event)
        assert run_calls == ["fake-consumer"]


class TestEntryPointSourceNeverReferencesSecrets:
    def test_database_uri_is_never_referenced_in_the_entry_point_source(self) -> None:
        source = Path(main_module.__file__).read_text(encoding="utf-8")

        assert "DATABASE_URI" not in source

    def test_entry_point_no_longer_uses_print_for_application_logging(self) -> None:
        source = Path(main_module.__file__).read_text(encoding="utf-8")

        assert "print(" not in source


class TestBuildConsumerWiring:
    def test_wires_repository_use_case_handler_and_consumer_together(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: dict[str, object] = {}

        class FakeRepository:
            def __init__(self, engine: object) -> None:
                calls["repository_engine"] = engine

        class FakeUseCase:
            def __init__(self, repository: object) -> None:
                calls["use_case_repository"] = repository

        class FakeHandler:
            def __init__(self, add_ip_use_case: object) -> None:
                calls["handler_use_case"] = add_ip_use_case

        class FakeRabbitMqCommandConsumer:
            def __init__(self, url: str, queue_name: str, handler: object) -> None:
                calls["consumer_url"] = url
                calls["consumer_queue_name"] = queue_name
                calls["consumer_handler"] = handler

        monkeypatch.setattr(main_module, "SqlAlchemyRuleRepository", FakeRepository)
        monkeypatch.setattr(main_module, "AddIpUseCase", FakeUseCase)
        monkeypatch.setattr(main_module, "CreateRulesCommandHandler", FakeHandler)
        monkeypatch.setattr(main_module, "RabbitMqCommandConsumer", FakeRabbitMqCommandConsumer)

        consumer = main_module.build_consumer()

        assert isinstance(consumer, FakeRabbitMqCommandConsumer)
        assert calls["repository_engine"] is main_module.engine
        assert isinstance(calls["use_case_repository"], FakeRepository)
        assert isinstance(calls["handler_use_case"], FakeUseCase)
        assert isinstance(calls["consumer_handler"], FakeHandler)
        assert calls["consumer_url"] == settings.CLOUDAMQP_URL
        assert calls["consumer_queue_name"] == settings.RABBITMQ_QUEUE


class TestRunLifecycle:
    async def test_starts_the_consumer_then_stops_it_once_the_stop_event_is_already_set(self) -> None:
        consumer = FakeConsumer()
        stop_event = asyncio.Event()
        stop_event.set()

        await main_module.run(consumer, stop_event)

        assert consumer.start_calls == 1
        assert consumer.stop_calls == 1

    async def test_does_not_stop_before_the_stop_event_is_set(self) -> None:
        consumer = FakeConsumer()
        stop_event = asyncio.Event()

        task = asyncio.create_task(main_module.run(consumer, stop_event))
        await asyncio.sleep(0)

        assert consumer.start_calls == 1
        assert consumer.stop_calls == 0

        stop_event.set()
        await asyncio.wait_for(task, timeout=1)

        assert consumer.stop_calls == 1

    async def test_stops_gracefully_on_sigint(self) -> None:
        consumer = FakeConsumer()
        stop_event = asyncio.Event()

        task = asyncio.create_task(main_module.run(consumer, stop_event))
        await asyncio.sleep(0)  # let the signal handler register before raising

        signal.raise_signal(signal.SIGINT)
        await asyncio.wait_for(task, timeout=1)

        assert consumer.stop_calls == 1

    async def test_restores_the_previous_sigint_handler_after_returning(self) -> None:
        original_handler = signal.getsignal(signal.SIGINT)
        consumer = FakeConsumer()
        stop_event = asyncio.Event()
        stop_event.set()

        await main_module.run(consumer, stop_event)

        assert signal.getsignal(signal.SIGINT) == original_handler

    async def test_a_fresh_stop_event_is_created_when_none_is_given(self) -> None:
        consumer = FakeConsumer()

        task = asyncio.create_task(main_module.run(consumer))
        await asyncio.sleep(0)
        assert consumer.start_calls == 1
        assert consumer.stop_calls == 0

        signal.raise_signal(signal.SIGINT)
        await asyncio.wait_for(task, timeout=1)

        assert consumer.stop_calls == 1
