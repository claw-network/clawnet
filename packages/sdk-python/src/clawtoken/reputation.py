"""Reputation API — profiles, reviews, record."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from clawtoken.http import AsyncHttpClient, HttpClient


class ReputationApi:
    """Synchronous Reputation API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def get_profile(self, did: str) -> dict[str, Any]:
        """Get reputation profile for a DID."""
        return self._http.get(f"/api/reputation/{quote(did, safe='')}")

    def get_reviews(
        self,
        did: str,
        *,
        source: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> dict[str, Any]:
        """Get reviews for a DID."""
        params: dict[str, Any] = {}
        if source:
            params["source"] = source
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return self._http.get(f"/api/reputation/{quote(did, safe='')}/reviews", params or None)

    def record(self, **kwargs: Any) -> dict[str, Any]:
        """Record a reputation event (rate another agent)."""
        return self._http.post("/api/reputation/record", kwargs)


class AsyncReputationApi:
    """Asynchronous Reputation API."""

    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def get_profile(self, did: str) -> dict[str, Any]:
        return await self._http.get(f"/api/reputation/{quote(did, safe='')}")

    async def get_reviews(
        self,
        did: str,
        *,
        source: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if source:
            params["source"] = source
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return await self._http.get(f"/api/reputation/{quote(did, safe='')}/reviews", params or None)

    async def record(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/reputation/record", kwargs)
