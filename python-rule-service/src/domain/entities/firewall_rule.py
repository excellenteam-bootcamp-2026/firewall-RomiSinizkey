from dataclasses import dataclass
from ipaddress import IPv4Address
from typing import Literal

from src.domain.errors import InvalidIpError

RuleMode = Literal["blacklist", "whitelist"]


def _validate_ipv4(value: str) -> str:
    if not isinstance(value, str):
        raise InvalidIpError(f"{value!r} is not a valid IPv4 address.")
    try:
        IPv4Address(value)
    except ValueError:
        raise InvalidIpError(f'"{value}" is not a valid IPv4 address.') from None
    return value


@dataclass(frozen=True)
class NewFirewallRule:
    mode: RuleMode
    value: str

    def __post_init__(self) -> None:
        _validate_ipv4(self.value)


@dataclass(frozen=True)
class FirewallRule:
    id: int
    mode: RuleMode
    value: str
    active: bool
