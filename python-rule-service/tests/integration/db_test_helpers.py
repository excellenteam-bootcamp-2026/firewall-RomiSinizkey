import os
from urllib.parse import urlparse

# Deliberately reads its own TEST_DATABASE_URI, fully decoupled from
# src.main.config / settings.DATABASE_URI (the app's own dev/prod config) -
# mirroring Node's tests/integration/db/testDatabase.ts, which never imports
# env.ts or connection.ts either. There is no code path by which these tests
# could reach a non-test database through the application's own config.
TEST_DATABASE_URI = os.environ.get("TEST_DATABASE_URI")


def _validate_test_database_uri(uri: str) -> str:
    database_name = urlparse(uri).path.lstrip("/")
    if not database_name.endswith("_test"):
        raise RuntimeError(
            f"Refusing to run PostgreSQL integration tests: the configured test database "
            f"({database_name!r}) does not end with \"_test\". This guard exists to make it "
            "impossible for these tests to accidentally target a development or production "
            "database."
        )
    return uri


# Evaluated once at import time, so misconfiguration is caught immediately -
# before any migration, cleanup, or query ever runs - rather than partway
# through a test run.
if TEST_DATABASE_URI is not None:
    _validate_test_database_uri(TEST_DATABASE_URI)

has_test_database_config = TEST_DATABASE_URI is not None
