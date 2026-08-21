from src.main.config import settings


def main() -> None:
    print(f"python-rule-service config OK - ENV={settings.ENV} LOG_LEVEL={settings.LOG_LEVEL}")


if __name__ == "__main__":
    main()
