import pytest

from src.application.ports.rule_repository import RuleRepository
from src.domain.entities.firewall_rule import FirewallRule, NewFirewallRule
from tests.unit.conftest import FakeRuleRepository


class TestRuleRepositoryPort:
    def test_cannot_be_instantiated_directly(self) -> None:
        with pytest.raises(TypeError):
            RuleRepository()  # type: ignore[abstract]

    def test_a_concrete_subclass_implementing_add_can_be_instantiated(
        self, fake_repository: FakeRuleRepository
    ) -> None:
        result = fake_repository.add(NewFirewallRule(mode="blacklist", value="192.168.1.1"))

        assert result == FirewallRule(id=1, mode="blacklist", value="192.168.1.1", active=True)
