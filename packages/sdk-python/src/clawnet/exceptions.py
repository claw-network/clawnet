"""Custom exceptions for the ClawNet SDK."""

from __future__ import annotations

from typing import Any


class ClawNetError(Exception):
    """Raised when the ClawNet node returns an error response."""

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
        return f"ClawNetError(status={self.status}, code={self.code!r}, message={str(self)!r})"
