from abc import ABC, abstractmethod

from src.domain.entities.firewall_rule import FirewallRule, NewFirewallRule


class RuleRepository(ABC):
    @abstractmethod
    def add(self, rule: NewFirewallRule) -> FirewallRule:
        raise NotImplementedError
