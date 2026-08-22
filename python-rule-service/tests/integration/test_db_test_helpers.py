import importlib
import os
from contextlib import contextmanager
from typing import Iterator

import pytest

from tests.integration import db_test_helpers

# Pure logic tests for the test-database safety guard - no real PostgreSQL
# connection is made or required anywhere in this file.


@contextmanager
def _test_database_uri(monkeypatch: pytest.MonkeyPatch, value: str | None) -> Iterator[None]:
    original = os.environ.get("TEST_DATABASE_URI")
    if value is None:
        monkeypatch.delenv("TEST_DATABASE_URI", raising=False)
    else:
        monkeypatch.setenv("TEST_DATABASE_URI", value)
    try:
        yield
    finally:
        if original is None:
            monkeypatch.delenv("TEST_DATABASE_URI", raising=False)
        else:
            monkeypatch.setenv("TEST_DATABASE_URI", original)
        importlib.reload(db_test_helpers)


class TestValidateTestDatabaseUri:
    @pytest.mark.parametrize(
        "uri",
        [
            "postgresql+psycopg://u:p@localhost:5432/firewall_test",
            "postgresql+psycopg://u:p@localhost:5432/my_service_test",
        ],
    )
    def test_accepts_a_database_name_ending_in_test(self, uri: str) -> None:
        assert db_test_helpers._validate_test_database_uri(uri) == uri

    @pytest.mark.parametrize(
        "uri",
        [
            "postgresql+psycopg://u:p@localhost:5432/firewall_dev",
            "postgresql+psycopg://u:p@localhost:5432/firewall_prod",
            "postgresql+psycopg://u:p@localhost:5432/firewall_test_backup",
        ],
    )
    def test_rejects_a_database_name_not_ending_in_test(self, uri: str) -> None:
        with pytest.raises(RuntimeError, match="_test"):
            db_test_helpers._validate_test_database_uri(uri)


class TestModuleImportGuard:
    def test_module_raises_at_import_time_for_a_non_test_database(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with _test_database_uri(monkeypatch, "postgresql+psycopg://u:p@localhost:5432/firewall_dev"):
            with pytest.raises(RuntimeError, match="_test"):
                importlib.reload(db_test_helpers)

    def test_has_test_database_config_is_false_when_unset(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with _test_database_uri(monkeypatch, None):
            importlib.reload(db_test_helpers)
            assert db_test_helpers.has_test_database_config is False

    def test_has_test_database_config_is_true_for_a_valid_test_database(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with _test_database_uri(monkeypatch, "postgresql+psycopg://u:p@localhost:5432/firewall_test"):
            importlib.reload(db_test_helpers)
            assert db_test_helpers.has_test_database_config is True
