"""Identity API — DID resolution, capabilities."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from clawnet.http import AsyncHttpClient, HttpClient


class IdentityApi:
    """Synchronous Identity API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def get(self) -> dict[str, Any]:
        """Get this node's identity."""
        return self._http.get("/api/v1/identities/self")

    def resolve(self, did: str, *, source: str | None = None) -> dict[str, Any]:
        """Resolve another agent's identity by DID."""
        params = {"source": source} if source else None
        return self._http.get(f"/api/v1/identities/{quote(did, safe='')}", params)

    def list_capabilities(self) -> dict[str, Any]:
        """List registered capabilities for this node."""
        identity = self._http.get("/api/v1/identities/self")
        capabilities = identity.get("capabilities", []) if isinstance(identity, dict) else []
        return {"capabilities": capabilities}

    def register_capability(self, did: str, **kwargs: Any) -> dict[str, Any]:
        """Register a new capability credential."""
        return self._http.post(
            f"/api/v1/identities/{quote(did, safe='')}/capabilities", kwargs
        )


class AsyncIdentityApi:
    """Asynchronous Identity API."""

    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def get(self) -> dict[str, Any]:
        return await self._http.get("/api/v1/identities/self")

    async def resolve(self, did: str, *, source: str | None = None) -> dict[str, Any]:
        params = {"source": source} if source else None
        return await self._http.get(f"/api/v1/identities/{quote(did, safe='')}", params)

    async def list_capabilities(self) -> dict[str, Any]:
        identity = await self._http.get("/api/v1/identities/self")
        capabilities = identity.get("capabilities", []) if isinstance(identity, dict) else []
        return {"capabilities": capabilities}

    async def register_capability(self, did: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/identities/{quote(did, safe='')}/capabilities", kwargs
        )
