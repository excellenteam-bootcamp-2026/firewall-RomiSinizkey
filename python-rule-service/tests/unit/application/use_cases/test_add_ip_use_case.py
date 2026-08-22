import pytest

from src.application.errors import ApplicationError
from src.application.use_cases.add_ip_use_case import AddIpUseCase
from src.domain.entities.firewall_rule import FirewallRule, NewFirewallRule
from tests.unit.conftest import FakeRuleRepository


class TestValidIpAddsThroughTheRepository:
    def test_repository_is_invoked_once_with_the_constructed_domain_rule(
        self, fake_repository: FakeRuleRepository
    ) -> None:
        use_case = AddIpUseCase(fake_repository)

        use_case.execute(mode="blacklist", value="192.168.1.1")

        assert fake_repository.calls == [NewFirewallRule(mode="blacklist", value="192.168.1.1")]

    def test_use_case_returns_exactly_what_the_repository_returns(
        self, fake_repository: FakeRuleRepository
    ) -> None:
        use_case = AddIpUseCase(fake_repository)

        result = use_case.execute(mode="whitelist", value="10.0.0.1")

        assert result == FirewallRule(id=1, mode="whitelist", value="10.0.0.1", active=True)


class TestInvalidIpNeverReachesTheRepository:
    def test_repository_add_is_not_called_for_an_invalid_ip(self, fake_repository: FakeRuleRepository) -> None:
        use_case = AddIpUseCase(fake_repository)

        with pytest.raises(ApplicationError):
            use_case.execute(mode="blacklist", value="not-an-ip")

        assert fake_repository.calls == []


class TestInvalidIpErrorBecomesApplicationError:
    def test_raises_application_error_with_invalid_ip_code(self, fake_repository: FakeRuleRepository) -> None:
        use_case = AddIpUseCase(fake_repository)

        with pytest.raises(ApplicationError) as excinfo:
            use_case.execute(mode="blacklist", value="999.999.999.999")

        assert excinfo.value.code == "INVALID_IP"
        assert "999.999.999.999" in excinfo.value.message
