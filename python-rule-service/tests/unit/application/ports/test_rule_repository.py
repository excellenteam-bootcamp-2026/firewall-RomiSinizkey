import pytest

from src.application.ports.rule_repository import RuleRepository
from src.domain.entities.firewall_rule import FirewallRule, NewFirewallRule


class TestRuleRepositoryPort:
    def test_cannot_be_instantiated_directly(self) -> None:
        with pytest.raises(TypeError):
            RuleRepository()  # type: ignore[abstract]

    def test_a_concrete_subclass_implementing_add_can_be_instantiated(self) -> None:
        class _FakeRepository(RuleRepository):
            def add(self, rule: NewFirewallRule) -> FirewallRule:
                return FirewallRule(id=1, mode=rule.mode, value=rule.value, active=True)

        repository = _FakeRepository()

        result = repository.add(NewFirewallRule(mode="blacklist", value="192.168.1.1"))

        assert result == FirewallRule(id=1, mode="blacklist", value="192.168.1.1", active=True)
