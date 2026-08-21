import os

# Set a safe, non-secret baseline *before* importing src.main.config below - the
# module validates and constructs its `settings` singleton at import time (the
# fail-fast behavior this test file exists to verify), so collection itself
# would fail here without a valid environment already in place.
os.environ["ENV"] = "dev"
os.environ["DATABASE_URI"] = "postgresql://test_user:test_pass@localhost:5432/firewall_dev"
os.environ["LOG_LEVEL"] = "INFO"

import pytest
from pydantic import ValidationError

from src.main.config import Settings, load_settings, settings

ENV_KEYS = ("ENV", "DATABASE_URI", "LOG_LEVEL")

VALID_ENV = {
    "ENV": "dev",
    "DATABASE_URI": "postgresql://test_user:test_pass@localhost:5432/firewall_dev",
    "LOG_LEVEL": "INFO",
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
    def test_loads_all_three_fields(self, monkeypatch: pytest.MonkeyPatch) -> None:
        result = _build_settings(monkeypatch, VALID_ENV)

        assert result.ENV == "dev"
        assert result.DATABASE_URI == VALID_ENV["DATABASE_URI"]
        assert result.LOG_LEVEL == "INFO"

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
            "ENV": "production",
            "DATABASE_URI": "postgresql://u:p@host:5432/firewall_prod",
            "LOG_LEVEL": "INFO",
        }

        result = _build_settings(monkeypatch, overrides)

        assert result.ENV == "production"


class TestNoSecretLeakage:
    def test_validation_error_never_contains_the_password(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _set_env(monkeypatch, {**VALID_ENV, "ENV": None})
        monkeypatch.setenv("DATABASE_URI", "postgresql://user:SUPERSECRET@host/db")

        with pytest.raises(RuntimeError) as excinfo:
            load_settings()

        assert "SUPERSECRET" not in str(excinfo.value)
