class ApplicationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"

    def __repr__(self) -> str:
        return f"ApplicationError(code={self.code!r}, message={self.message!r})"

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}
