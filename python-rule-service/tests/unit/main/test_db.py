from sqlalchemy.engine import Engine

from src.main.config import settings
from src.main.db import engine


class TestEngine:
    def test_engine_is_constructed_and_points_at_the_configured_database(self) -> None:
        assert isinstance(engine, Engine)
        assert engine.url.database == settings.DATABASE_URI.rsplit("/", 1)[-1]

    def test_engine_string_form_never_exposes_the_configured_password(self) -> None:
        password = engine.url.password

        assert password is not None
        assert password not in str(engine)
        assert password not in repr(engine)
        assert password not in str(engine.url)
