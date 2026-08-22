from pathlib import Path

import pytest

import src.domain.entities.firewall_rule as firewall_rule_module
from src.domain.entities.firewall_rule import FirewallRule, NewFirewallRule
from src.domain.errors import InvalidIpError


class TestValidIPv4Input:
    def test_accepts_a_valid_dotted_decimal_address(self) -> None:
        rule = NewFirewallRule(mode="blacklist", value="192.168.1.1")

        assert rule.mode == "blacklist"
        assert rule.value == "192.168.1.1"

    @pytest.mark.parametrize("value", ["0.0.0.0", "255.255.255.255", "10.0.0.1"])
    def test_accepts_edge_of_range_addresses(self, value: str) -> None:
        rule = NewFirewallRule(mode="whitelist", value=value)

        assert rule.value == value


class TestInvalidIPv4Input:
    @pytest.mark.parametrize(
        "value",
        [
            "256.1.1.1",
            "192.168.1",
            "192.168.1.1.1",
            "01.1.1.1",
            "192.168.1.1/24",
            " 192.168.1.1",
            "not-an-ip",
            "",
        ],
    )
    def test_rejects_malformed_ipv4_strings(self, value: str) -> None:
        with pytest.raises(InvalidIpError):
            NewFirewallRule(mode="blacklist", value=value)

    def test_rejects_a_non_string_value_instead_of_silently_coercing_it(self) -> None:
        # ipaddress.IPv4Address itself accepts an int as a packed 32-bit address
        # (e.g. IPv4Address(42) -> "0.0.0.42") - the domain must reject that
        # explicitly rather than silently reinterpreting a caller's mistake.
        with pytest.raises(InvalidIpError):
            NewFirewallRule(mode="blacklist", value=42)  # type: ignore[arg-type]


class TestIPv6ScopeDecision:
    def test_ipv6_addresses_are_out_of_scope_and_rejected(self) -> None:
        # Issue #58 scopes validation to IPv4 only ("same intent as Node's regex",
        # which never matched IPv6 either). IPv6 support is not requested by the
        # issue or the domain contract, so it is deliberately rejected here rather
        # than silently accepted.
        with pytest.raises(InvalidIpError):
            NewFirewallRule(mode="blacklist", value="::1")


class TestFirewallRule:
    def test_carries_id_mode_value_and_active(self) -> None:
        rule = FirewallRule(id=1, mode="blacklist", value="192.168.1.1", active=True)

        assert rule.id == 1
        assert rule.mode == "blacklist"
        assert rule.value == "192.168.1.1"
        assert rule.active is True


class TestDomainPurity:
    def test_module_has_no_forbidden_imports(self) -> None:
        source = Path(firewall_rule_module.__file__).read_text(encoding="utf-8")

        for forbidden in ("pydantic", "sqlalchemy", "structlog", "src.adapters", "src.application", "src.main"):
            assert forbidden not in source
