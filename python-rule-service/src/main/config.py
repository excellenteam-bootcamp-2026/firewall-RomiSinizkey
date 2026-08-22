from typing import Literal
from urllib.parse import urlparse

from pydantic import ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_VALID_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        frozen=True,
        extra="ignore",
    )

    ENV: Literal["dev", "production"]
    DATABASE_URI: str
    LOG_LEVEL: str

    @field_validator("DATABASE_URI")
    @classmethod
    def _database_uri_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value

    @field_validator("LOG_LEVEL")
    @classmethod
    def _log_level_supported(cls, value: str) -> str:
        upper = value.upper()
        if upper not in _VALID_LOG_LEVELS:
            raise ValueError(f"must be one of {sorted(_VALID_LOG_LEVELS)}")
        return upper

    @model_validator(mode="after")
    def _dev_must_not_target_production(self) -> "Settings":
        if self.ENV == "dev":
            database_name = urlparse(self.DATABASE_URI).path.lstrip("/").lower()
            if "prod" in database_name:
                raise ValueError(
                    "ENV=dev must not point DATABASE_URI at a production-looking "
                    f"database ({database_name!r}) - refusing to start"
                )
        return self


def _format_validation_error(exc: ValidationError) -> str:
    lines = []
    for error in exc.errors():
        path = ".".join(str(part) for part in error["loc"]) or "(configuration)"
        lines.append(f"  - {path}: {error['msg']}")
    return "Invalid python-rule-service configuration:\n" + "\n".join(lines)


def load_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        raise RuntimeError(_format_validation_error(exc)) from None


settings = load_settings()
