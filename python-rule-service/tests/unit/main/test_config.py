import pytest
from pydantic import ValidationError

from src.main.config import Settings, load_settings, settings

ENV_KEYS = (
    "ENV",
    "DATABASE_URI",
    "LOG_LEVEL",
    "CLOUDAMQP_URL",
    "RABBITMQ_EXCHANGE",
    "RABBITMQ_QUEUE",
    "RABBITMQ_ROUTING_PREFIX",
)

VALID_ENV = {
    "ENV": "dev",
    "DATABASE_URI": "postgresql://test_user:test_pass@localhost:5432/firewall_dev",
    "LOG_LEVEL": "INFO",
    "CLOUDAMQP_URL": "amqps://user:pass@host/vhost",
    "RABBITMQ_EXCHANGE": "firewall.commands",
    "RABBITMQ_QUEUE": "romi.firewall.commands",
    "RABBITMQ_ROUTING_PREFIX": "romi",
}


def _set_env(monkeypatch: pytest.MonkeyPatch, overrides: dict) -> None:
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    for key, value in overrides.items():
        if value is not None:
            monkeypatch.setenv(key, value)


def _build_settings(monkeypatch: pytest.MonkeyPatch, overrides: dict) -> Settings:
    _set_env(monkeypatch, overrides)
    return Settings(_env_file=None)


class TestValidConfiguration:
    def test_loads_all_fields(self, monkeypatch: pytest.MonkeyPatch) -> None:
        result = _build_settings(monkeypatch, VALID_ENV)

        assert result.ENV == "dev"
        assert result.DATABASE_URI == VALID_ENV["DATABASE_URI"]
        assert result.LOG_LEVEL == "INFO"
        assert result.CLOUDAMQP_URL == VALID_ENV["CLOUDAMQP_URL"]
        assert result.RABBITMQ_EXCHANGE == VALID_ENV["RABBITMQ_EXCHANGE"]
        assert result.RABBITMQ_QUEUE == VALID_ENV["RABBITMQ_QUEUE"]
        assert result.RABBITMQ_ROUTING_PREFIX == VALID_ENV["RABBITMQ_ROUTING_PREFIX"]

    def test_log_level_is_case_insensitive_and_normalized(self, monkeypatch: pytest.MonkeyPatch) -> None:
        result = _build_settings(monkeypatch, {**VALID_ENV, "LOG_LEVEL": "debug"})

        assert result.LOG_LEVEL == "DEBUG"

    def test_module_level_settings_singleton_is_valid(self) -> None:
        assert settings.ENV == "dev"
        assert settings.LOG_LEVEL == "INFO"


class TestMissingVariables:
    @pytest.mark.parametrize("missing_key", ENV_KEYS)
    def test_missing_required_variable_raises(self, monkeypatch: pytest.MonkeyPatch, missing_key: str) -> None:
        with pytest.raises(ValidationError):
            _build_settings(monkeypatch, {**VALID_ENV, missing_key: None})


class TestInvalidEnv:
    def test_rejects_unknown_env_value(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with pytest.raises(ValidationError):
            _build_settings(monkeypatch, {**VALID_ENV, "ENV": "staging"})


class TestInvalidLogLevel:
    def test_rejects_unsupported_log_level(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with pytest.raises(ValidationError):
            _build_settings(monkeypatch, {**VALID_ENV, "LOG_LEVEL": "VERBOSE"})


class TestBlankRabbitMqSettings:
    @pytest.mark.parametrize(
        "blank_key",
        ("CLOUDAMQP_URL", "RABBITMQ_EXCHANGE", "RABBITMQ_QUEUE", "RABBITMQ_ROUTING_PREFIX"),
    )
    def test_blank_value_raises(self, monkeypatch: pytest.MonkeyPatch, blank_key: str) -> None:
        with pytest.raises(ValidationError):
            _build_settings(monkeypatch, {**VALID_ENV, blank_key: "   "})


class TestImmutability:
    def test_settings_instance_is_frozen(self, monkeypatch: pytest.MonkeyPatch) -> None:
        result = _build_settings(monkeypatch, VALID_ENV)

        with pytest.raises(ValidationError):
            result.ENV = "production"


class TestDevProductionSafetyGuard:
    def test_dev_env_rejects_production_looking_database(self, monkeypatch: pytest.MonkeyPatch) -> None:
        overrides = {**VALID_ENV, "DATABASE_URI": "postgresql://u:p@host:5432/firewall_prod"}

        with pytest.raises(ValidationError):
            _build_settings(monkeypatch, overrides)

    def test_dev_env_accepts_a_dev_database(self, monkeypatch: pytest.MonkeyPatch) -> None:
        result = _build_settings(monkeypatch, VALID_ENV)

        assert result.ENV == "dev"

    def test_production_env_accepts_a_production_database(self, monkeypatch: pytest.MonkeyPatch) -> None:
        overrides = {
            **VALID_ENV,
            "ENV": "production",
            "DATABASE_URI": "postgresql://u:p@host:5432/firewall_prod",
        }

        result = _build_settings(monkeypatch, overrides)

        assert result.ENV == "production"


class TestNoSecretLeakage:
    def test_validation_error_never_contains_the_password(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # This test deletes ENV from os.environ to simulate a missing variable,
        # then calls load_settings() -> bare Settings() (not _build_settings(),
        # since it's load_settings()'s own RuntimeError formatting under test).
        # Bare Settings() still reads python-rule-service/.env by default, so a
        # developer's real .env with ENV=dev would silently fill the gap this
        # test creates and the raise would never happen. Disabling env_file for
        # the duration of this test only (monkeypatch reverts it afterward)
        # keeps this test isolated from that file without changing what
        # Settings/load_settings do for real callers like `python -m src.main`.
        monkeypatch.setitem(Settings.model_config, "env_file", None)

        _set_env(monkeypatch, {**VALID_ENV, "ENV": None})
        monkeypatch.setenv("DATABASE_URI", "postgresql://user:SUPERSECRET@host/db")

        with pytest.raises(RuntimeError) as excinfo:
            load_settings()

        assert "SUPERSECRET" not in str(excinfo.value)
