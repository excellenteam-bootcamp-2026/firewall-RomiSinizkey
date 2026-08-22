from src.application.errors import ApplicationError
from src.application.ports.rule_repository import RuleRepository
from src.domain.entities.firewall_rule import FirewallRule, NewFirewallRule, RuleMode
from src.domain.errors import InvalidIpError
from src.main.logger import logger


class AddIpUseCase:
    def __init__(self, repository: RuleRepository) -> None:
        self._repository = repository

    def execute(self, mode: RuleMode, value: str) -> FirewallRule:
        try:
            new_rule = NewFirewallRule(mode=mode, value=value)
        except InvalidIpError as exc:
            logger.warning("add_ip_rejected", mode=mode, value=value)
            raise ApplicationError(code="INVALID_IP", message=exc.message) from None

        created = self._repository.add(new_rule)
        logger.info("add_ip_succeeded", mode=mode, rule_id=created.id)
        return created
