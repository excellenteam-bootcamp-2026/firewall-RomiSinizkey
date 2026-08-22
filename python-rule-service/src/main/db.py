from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from src.main.config import settings

engine: Engine = create_engine(settings.DATABASE_URI)
