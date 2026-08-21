import os

# src.main.config validates and constructs its `settings` singleton the instant
# it is first imported (fail-fast at import time, by design - see #56). Any test
# module that transitively imports it - directly, or via logger.py/__main__.py -
# would otherwise fail at collection unless a valid environment already happens
# to be in place. setdefault() only fills in what's missing, so a real value set
# elsewhere is never overridden.
os.environ.setdefault("ENV", "dev")
os.environ.setdefault("DATABASE_URI", "postgresql://test_user:test_pass@localhost:5432/firewall_dev")
os.environ.setdefault("LOG_LEVEL", "INFO")
