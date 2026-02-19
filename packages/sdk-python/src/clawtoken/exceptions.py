"""Custom exceptions for the ClawToken SDK."""

from __future__ import annotations

from typing import Any


class ClawTokenError(Exception):
    """Raised when the ClawToken node returns an error response."""

    def __init__(
        self,
        message: str,
        *,
        status: int = 0,
        code: str | None = None,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details

    def __repr__(self) -> str:
        return f"ClawTokenError(status={self.status}, code={self.code!r}, message={str(self)!r})"
