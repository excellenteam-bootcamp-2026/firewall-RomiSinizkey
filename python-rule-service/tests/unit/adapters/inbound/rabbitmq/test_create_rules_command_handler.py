import pytest
import structlog
from structlog.testing import capture_logs

from src.adapters.inbound.rabbitmq.create_rules_command_handler import CreateRulesCommandHandler
from src.adapters.inbound.rabbitmq.message_models import CreateRulesCommand
from src.application.use_cases.add_ip_use_case import AddIpUseCase
from src.domain.entities.firewall_rule import NewFirewallRule
from src.main.logger import logger
from tests.unit.conftest import FakeRuleRepository

OPERATION_ID = "11111111-1111-1111-1111-111111111111"

# capture_logs() disables all configured processors by default (including
# logger.py's merge_contextvars) for test isolation - pass it back in
# explicitly wherever a test needs bound contextvars actually merged in.
CONTEXTVARS_PROCESSOR = [structlog.contextvars.merge_contextvars]


def build_command(values: list[str], mode: str = "blacklist") -> CreateRulesCommand:
    return CreateRulesCommand.model_validate(
        {
            "operation_id": OPERATION_ID,
            "command_type": "create_rules",
            "payload": {"type": "ip", "mode": mode, "values": values},
        }
    )


class TestSingleValue:
    async def test_calls_add_ip_use_case_with_the_correct_mode_and_value(
        self, fake_repository: FakeRuleRepository
    ) -> None:
        handler = CreateRulesCommandHandler(AddIpUseCase(fake_repository))
        command = build_command(["1.2.3.4"], mode="blacklist")

        await handler(command)

        assert fake_repository.calls == [NewFirewallRule(mode="blacklist", value="1.2.3.4")]


class TestMultipleValues:
    async def test_calls_add_ip_use_case_once_per_value_in_order(
        self, fake_repository: FakeRuleRepository
    ) -> None:
        handler = CreateRulesCommandHandler(AddIpUseCase(fake_repository))
        command = build_command(["1.1.1.1", "8.8.8.8"], mode="whitelist")

        await handler(command)

        assert fake_repository.calls == [
            NewFirewallRule(mode="whitelist", value="1.1.1.1"),
            NewFirewallRule(mode="whitelist", value="8.8.8.8"),
        ]


class TestOperationIdLogging:
    async def test_operation_id_reaches_the_handlers_own_log_lines(
        self, fake_repository: FakeRuleRepository
    ) -> None:
        handler = CreateRulesCommandHandler(AddIpUseCase(fake_repository))
        command = build_command(["1.2.3.4"])

        with capture_logs(processors=CONTEXTVARS_PROCESSOR) as captured:
            await handler(command)

        own_events = [
            e for e in captured if e["event"] in ("create_rules_command_received", "create_rules_command_processed")
        ]
        assert len(own_events) == 2
        for event in own_events:
            assert event["operation_id"] == OPERATION_ID

    async def test_operation_id_reaches_add_ip_use_cases_existing_log_line_unmodified(
        self, fake_repository: FakeRuleRepository
    ) -> None:
        # Proves operation_id reaches AddIpUseCase's own "add_ip_succeeded"
        # log line without that module being modified at all - via structlog
        # contextvars, which propagate across asyncio.to_thread().
        handler = CreateRulesCommandHandler(AddIpUseCase(fake_repository))
        command = build_command(["1.2.3.4"])

        with capture_logs(processors=CONTEXTVARS_PROCESSOR) as captured:
            await handler(command)

        add_ip_events = [e for e in captured if e["event"] == "add_ip_succeeded"]
        assert len(add_ip_events) == 1
        assert add_ip_events[0]["operation_id"] == OPERATION_ID

    async def test_operation_id_is_unbound_after_handling_completes(
        self, fake_repository: FakeRuleRepository
    ) -> None:
        handler = CreateRulesCommandHandler(AddIpUseCase(fake_repository))
        command = build_command(["1.2.3.4"])

        await handler(command)

        with capture_logs(processors=CONTEXTVARS_PROCESSOR) as captured:
            logger.info("after_handling_completed")

        assert "operation_id" not in captured[0]


class TestFailurePropagatesRatherThanBeingSwallowed:
    async def test_a_repository_failure_propagates_out_of_the_handler(self) -> None:
        class FailingRepository:
            def add(self, rule: NewFirewallRule) -> None:
                raise RuntimeError("database is down")

        handler = CreateRulesCommandHandler(AddIpUseCase(FailingRepository()))  # type: ignore[arg-type]
        command = build_command(["1.2.3.4"])

        with pytest.raises(RuntimeError):
            await handler(command)

    async def test_operation_id_is_still_unbound_after_a_failure(self, fake_repository: FakeRuleRepository) -> None:
        class FailingRepository:
            def add(self, rule: NewFirewallRule) -> None:
                raise RuntimeError("database is down")

        handler = CreateRulesCommandHandler(AddIpUseCase(FailingRepository()))  # type: ignore[arg-type]
        command = build_command(["1.2.3.4"])

        with pytest.raises(RuntimeError):
            await handler(command)

        with capture_logs(processors=CONTEXTVARS_PROCESSOR) as captured:
            logger.info("after_failed_handling")

        assert "operation_id" not in captured[0]
