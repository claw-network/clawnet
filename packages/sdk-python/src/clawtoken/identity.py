"""Identity API — DID resolution, capabilities."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from clawtoken.http import AsyncHttpClient, HttpClient


class IdentityApi:
    """Synchronous Identity API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def get(self, did: str) -> dict[str, Any]:
        """Get identity document by DID."""
        return self._http.get(f"/api/identity/{quote(did, safe='')}")

    def resolve(self, did: str, *, source: str | None = None) -> dict[str, Any]:
        """Resolve a DID. Optionally specify *source* (``'store'`` or ``'log'``)."""
        params = {"source": source} if source else None
        return self._http.get(f"/api/identity/{quote(did, safe='')}", params)

    def list_capabilities(self, did: str, *, limit: int | None = None, offset: int | None = None) -> dict[str, Any]:
        """List capabilities for a DID."""
        params: dict[str, Any] = {"did": did}
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return self._http.get("/api/identity/capabilities", params)

    def register_capability(self, **kwargs: Any) -> dict[str, Any]:
        """Register a new capability credential."""
        return self._http.post("/api/identity/capabilities", kwargs)


class AsyncIdentityApi:
    """Asynchronous Identity API."""

    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def get(self, did: str) -> dict[str, Any]:
        return await self._http.get(f"/api/identity/{quote(did, safe='')}")

    async def resolve(self, did: str, *, source: str | None = None) -> dict[str, Any]:
        params = {"source": source} if source else None
        return await self._http.get(f"/api/identity/{quote(did, safe='')}", params)

    async def list_capabilities(self, did: str, *, limit: int | None = None, offset: int | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"did": did}
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return await self._http.get("/api/identity/capabilities", params)

    async def register_capability(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/identity/capabilities", kwargs)
