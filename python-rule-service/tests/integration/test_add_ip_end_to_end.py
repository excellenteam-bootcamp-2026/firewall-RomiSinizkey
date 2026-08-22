import pytest
from sqlalchemy.engine import Engine

from src.adapters.outbound.persistence.postgres.schema import firewall_rules
from src.adapters.outbound.persistence.postgres.sqlalchemy_rule_repository import SqlAlchemyRuleRepository
from src.application.errors import ApplicationError
from src.application.use_cases.add_ip_use_case import AddIpUseCase
from src.domain.entities.firewall_rule import FirewallRule
from tests.integration.db_test_helpers import has_test_database_config

# The complete Add IP path against a real database: AddIpUseCase ->
# SqlAlchemyRuleRepository -> PostgreSQL. Complements the narrower
# use-case-only tests (fake repository, tests/unit/) and
# repository-only tests (real Postgres, no use case,
# test_sqlalchemy_rule_repository.py) with one test proving all three layers
# actually work wired together, not just each in isolation.
pytestmark = [
    pytest.mark.skipif(not has_test_database_config, reason="TEST_DATABASE_URI is not configured"),
    pytest.mark.usefixtures("_clean_firewall_rules_table"),
]


class TestAddIpEndToEnd:
    def test_valid_ip_flows_through_the_use_case_into_a_real_postgresql_row(self, engine: Engine) -> None:
        use_case = AddIpUseCase(SqlAlchemyRuleRepository(engine))

        created = use_case.execute(mode="blacklist", value="198.51.100.42")

        assert isinstance(created, FirewallRule)
        assert isinstance(created.id, int)
        assert created.mode == "blacklist"
        assert created.value == "198.51.100.42"
        assert created.active is True

        with engine.begin() as connection:
            row = connection.execute(firewall_rules.select().where(firewall_rules.c.id == created.id)).one()

        assert row.type == "ip"
        assert row.mode == "blacklist"
        assert row.value == "198.51.100.42"
        assert row.active is True

    def test_invalid_ip_never_reaches_postgresql(self, engine: Engine) -> None:
        use_case = AddIpUseCase(SqlAlchemyRuleRepository(engine))

        with pytest.raises(ApplicationError) as excinfo:
            use_case.execute(mode="blacklist", value="not-an-ip")

        assert excinfo.value.code == "INVALID_IP"

        with engine.begin() as connection:
            rows = connection.execute(firewall_rules.select()).all()

        assert rows == []
