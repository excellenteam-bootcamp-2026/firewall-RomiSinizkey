import structlog
from structlog.testing import capture_logs

from src.main.config import settings
from src.main.logger import logger


class TestStructuredOutput:
    def test_log_call_produces_a_structured_event_with_contextual_fields(self) -> None:
        with capture_logs() as captured:
            logger.info("smoke_test_event", widget="firewall-rule")

        assert len(captured) == 1
        event = captured[0]
        assert event["event"] == "smoke_test_event"
        assert event["widget"] == "firewall-rule"
        assert event["log_level"] == "info"

    def test_event_name_stays_stable_and_separate_from_contextual_fields(self) -> None:
        with capture_logs() as captured:
            logger.info("rule_added", rule_type="ip", mode="blacklist")

        event = captured[0]
        assert event["event"] == "rule_added"
        assert event["rule_type"] == "ip"
        assert event["mode"] == "blacklist"


class TestContextvarsBinding:
    def test_bound_contextvar_is_merged_into_a_log_call(self) -> None:
        structlog.contextvars.bind_contextvars(operation_id="11111111-1111-1111-1111-111111111111")
        try:
            with capture_logs(processors=[structlog.contextvars.merge_contextvars]) as captured:
                logger.info("event_during_bound_context")
        finally:
            structlog.contextvars.clear_contextvars()

        assert captured[0]["operation_id"] == "11111111-1111-1111-1111-111111111111"

    def test_unbinding_removes_the_context_from_later_log_calls(self) -> None:
        structlog.contextvars.bind_contextvars(operation_id="11111111-1111-1111-1111-111111111111")
        structlog.contextvars.unbind_contextvars("operation_id")

        with capture_logs() as captured:
            logger.info("event_after_unbind")

        assert "operation_id" not in captured[0]


class TestConfiguredLevelBehavior:
    def test_logger_level_matches_validated_settings(self) -> None:
        assert settings.LOG_LEVEL == "INFO"

    def test_debug_is_filtered_below_the_configured_info_level(self) -> None:
        with capture_logs() as captured:
            logger.debug("debug_event_should_be_filtered")
            logger.info("info_event_should_appear")

        events = [entry["event"] for entry in captured]
        assert "debug_event_should_be_filtered" not in events
        assert "info_event_should_appear" in events
