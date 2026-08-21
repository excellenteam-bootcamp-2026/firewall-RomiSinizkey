from src.main.config import settings
from src.main.logger import logger


def main() -> None:
    logger.info("service_startup", env=settings.ENV, configured_log_level=settings.LOG_LEVEL)


if __name__ == "__main__":
    main()
