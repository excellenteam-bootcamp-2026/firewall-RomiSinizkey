import pytest
from sqlalchemy.engine import Engine

from src.adapters.outbound.persistence.postgres.schema import firewall_rules
from src.adapters.outbound.persistence.postgres.sqlalchemy_rule_repository import SqlAlchemyRuleRepository
from src.domain.entities.firewall_rule import FirewallRule, NewFirewallRule
from tests.integration.db_test_helpers import has_test_database_config

# Runs against a real, isolated PostgreSQL database (TEST_DATABASE_URI, guarded
# in db_test_helpers.py to end with "_test"). Skips entirely when no test
# database is configured, so `pytest` stays DB-free by default. `engine` and
# the cleanup fixture come from tests/integration/conftest.py, shared with
# test_add_ip_end_to_end.py.
pytestmark = [
    pytest.mark.skipif(not has_test_database_config, reason="TEST_DATABASE_URI is not configured"),
    pytest.mark.usefixtures("_clean_firewall_rules_table"),
]


class TestSqlAlchemyRuleRepositoryAdd:
    def test_inserts_an_ip_rule_and_returns_a_populated_domain_rule(self, engine: Engine) -> None:
        repository = SqlAlchemyRuleRepository(engine)

        created = repository.add(NewFirewallRule(mode="blacklist", value="203.0.113.5"))

        assert isinstance(created, FirewallRule)
        assert isinstance(created.id, int)
        assert created.mode == "blacklist"
        assert created.value == "203.0.113.5"
        assert created.active is True

    def test_the_inserted_row_is_actually_present_in_postgresql(self, engine: Engine) -> None:
        repository = SqlAlchemyRuleRepository(engine)
        created = repository.add(NewFirewallRule(mode="whitelist", value="10.0.0.1"))

        with engine.begin() as connection:
            row = connection.execute(firewall_rules.select().where(firewall_rules.c.id == created.id)).one()

        assert row.type == "ip"
        assert row.mode == "whitelist"
        assert row.value == "10.0.0.1"
        assert row.active is True

    def test_each_call_assigns_a_distinct_database_generated_id(self, engine: Engine) -> None:
        repository = SqlAlchemyRuleRepository(engine)

        first = repository.add(NewFirewallRule(mode="blacklist", value="1.1.1.1"))
        second = repository.add(NewFirewallRule(mode="blacklist", value="2.2.2.2"))

        assert first.id != second.id
