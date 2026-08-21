from pathlib import Path

from structlog.testing import capture_logs

from src.main import __main__ as main_module
from src.main.config import settings


class TestStartupEvent:
    def test_main_emits_one_structured_event_with_only_safe_fields(self) -> None:
        with capture_logs() as captured:
            main_module.main()

        assert len(captured) == 1
        event = captured[0]
        assert event["event"] == "service_startup"
        assert event["env"] == settings.ENV
        assert event["configured_log_level"] == settings.LOG_LEVEL
        assert "database_uri" not in event
        assert settings.DATABASE_URI not in repr(event)


class TestEntryPointSourceNeverReferencesSecrets:
    def test_database_uri_is_never_referenced_in_the_entry_point_source(self) -> None:
        source = Path(main_module.__file__).read_text(encoding="utf-8")

        assert "DATABASE_URI" not in source

    def test_entry_point_no_longer_uses_print_for_application_logging(self) -> None:
        source = Path(main_module.__file__).read_text(encoding="utf-8")

        assert "print(" not in source
