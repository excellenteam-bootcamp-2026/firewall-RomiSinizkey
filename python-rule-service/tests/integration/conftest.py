from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from src.adapters.outbound.persistence.postgres.schema import firewall_rules
from tests.integration.db_test_helpers import TEST_DATABASE_URI

# Shared by every module that needs a real PostgreSQL connection. Neither
# fixture is autouse: this conftest also covers test_db_test_helpers.py's pure
# guard-logic tests, which must keep working with no TEST_DATABASE_URI at all.
# A module opts in with `pytestmark = [..., pytest.mark.usefixtures("_clean_firewall_rules_table")]`
# alongside its own `pytest.mark.skipif(not has_test_database_config, ...)`.


@pytest.fixture()
def engine() -> Iterator[Engine]:
    assert TEST_DATABASE_URI is not None  # only requested by tests already skipped without it
    test_engine = create_engine(TEST_DATABASE_URI)
    yield test_engine
    test_engine.dispose()


@pytest.fixture()
def _clean_firewall_rules_table(engine: Engine) -> Iterator[None]:
    with engine.begin() as connection:
        connection.execute(firewall_rules.delete())
    yield
    with engine.begin() as connection:
        connection.execute(firewall_rules.delete())
