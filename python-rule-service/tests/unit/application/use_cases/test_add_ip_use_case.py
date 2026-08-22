import pytest

from src.application.errors import ApplicationError
from src.application.ports.rule_repository import RuleRepository
from src.application.use_cases.add_ip_use_case import AddIpUseCase
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


class TestValidIpAddsThroughTheRepository:
    def test_repository_is_invoked_once_with_the_constructed_domain_rule(self) -> None:
        repository = FakeRuleRepository()
        use_case = AddIpUseCase(repository)

        use_case.execute(mode="blacklist", value="192.168.1.1")

        assert repository.calls == [NewFirewallRule(mode="blacklist", value="192.168.1.1")]

    def test_use_case_returns_exactly_what_the_repository_returns(self) -> None:
        repository = FakeRuleRepository()
        use_case = AddIpUseCase(repository)

        result = use_case.execute(mode="whitelist", value="10.0.0.1")

        assert result == FirewallRule(id=1, mode="whitelist", value="10.0.0.1", active=True)


class TestInvalidIpNeverReachesTheRepository:
    def test_repository_add_is_not_called_for_an_invalid_ip(self) -> None:
        repository = FakeRuleRepository()
        use_case = AddIpUseCase(repository)

        with pytest.raises(ApplicationError):
            use_case.execute(mode="blacklist", value="not-an-ip")

        assert repository.calls == []


class TestInvalidIpErrorBecomesApplicationError:
    def test_raises_application_error_with_invalid_ip_code(self) -> None:
        repository = FakeRuleRepository()
        use_case = AddIpUseCase(repository)

        with pytest.raises(ApplicationError) as excinfo:
            use_case.execute(mode="blacklist", value="999.999.999.999")

        assert excinfo.value.code == "INVALID_IP"
        assert "999.999.999.999" in excinfo.value.message
