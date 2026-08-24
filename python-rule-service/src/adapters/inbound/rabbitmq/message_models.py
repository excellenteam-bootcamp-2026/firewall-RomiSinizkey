from ipaddress import IPv4Address
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

# These models validate the RabbitMQ queue boundary - a message here is
# external input just like an HTTP request body, even though Node.js already
# validated it before publishing (see Exercise 7 Task 3). They intentionally
# mirror the small, fixed contract Node publishes and nothing more.


class CreateRulesPayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["ip"]
    mode: Literal["blacklist", "whitelist"]
    values: list[str]

    @field_validator("values")
    @classmethod
    def _values_are_a_non_empty_list_of_valid_ipv4_addresses(cls, value: list[str]) -> list[str]:
        if len(value) == 0:
            raise ValueError("values must be a non-empty list")
        for item in value:
            try:
                IPv4Address(item)
            except ValueError:
                raise ValueError(f"{item!r} is not a valid IPv4 address") from None
        return value


class CreateRulesCommand(BaseModel):
    model_config = ConfigDict(frozen=True)

    operation_id: str
    command_type: Literal["create_rules"]
    payload: CreateRulesPayload

    @field_validator("operation_id")
    @classmethod
    def _operation_id_is_a_valid_uuid(cls, value: str) -> str:
        try:
            UUID(value)
        except (ValueError, AttributeError, TypeError):
            raise ValueError("operation_id must be a valid UUID") from None
        return value
