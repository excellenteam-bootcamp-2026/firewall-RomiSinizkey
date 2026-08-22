from sqlalchemy import insert
from sqlalchemy.engine import Engine

from src.adapters.outbound.persistence.postgres.schema import firewall_rules
from src.application.ports.rule_repository import RuleRepository
from src.domain.entities.firewall_rule import FirewallRule, NewFirewallRule

# The domain model has no `type` field yet - only IP rules are ported (#58) -
# so this adapter always writes "ip"; domain/port types arrive in a later issue.
_RULE_TYPE = "ip"


class SqlAlchemyRuleRepository(RuleRepository):
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def add(self, rule: NewFirewallRule) -> FirewallRule:
        stmt = (
            insert(firewall_rules)
            .values(type=_RULE_TYPE, mode=rule.mode, value=rule.value, active=True)
            .returning(
                firewall_rules.c.id,
                firewall_rules.c.mode,
                firewall_rules.c.value,
                firewall_rules.c.active,
            )
        )
        with self._engine.begin() as connection:
            row = connection.execute(stmt).one()

        return FirewallRule(id=row.id, mode=row.mode, value=row.value, active=row.active)
