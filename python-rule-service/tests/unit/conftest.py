import pytest

from src.application.ports.rule_repository import RuleRepository
from src.domain.entities.firewall_rule import FirewallRule, NewFirewallRule


class FakeRuleRepository(RuleRepository):
    def __init__(self) -> None:
        self.calls: list[NewFirewallRule] = []
        self._next_id = 1

    def add(self, rule: NewFirewallRule) -> FirewallRule:
        self.calls.append(rule)
        created = FirewallRule(id=self._next_id, mode=rule.mode, value=rule.value, active=True)
        self._next_id += 1
        return created


@pytest.fixture()
def fake_repository() -> FakeRuleRepository:
    return FakeRuleRepository()
