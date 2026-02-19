"""Node API — status, peers, config, sync."""

from __future__ import annotations

import time
from typing import Any

from clawtoken.http import AsyncHttpClient, HttpClient


class NodeApi:
    """Synchronous Node API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def get_status(self) -> dict[str, Any]:
        """Get node status (DID, sync state, block height, peers)."""
        return self._http.get("/api/node/status")

    def get_peers(self, *, limit: int | None = None, offset: int | None = None) -> dict[str, Any]:
        """List connected peers."""
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return self._http.get("/api/node/peers", params or None)

    def get_config(self) -> dict[str, Any]:
        """Get node configuration."""
        return self._http.get("/api/node/config")

    def wait_for_sync(
        self,
        *,
        interval: float = 2.0,
        timeout: float = 60.0,
    ) -> dict[str, Any]:
        """Poll ``get_status`` until the node reports ``synced=True``.

        Raises ``TimeoutError`` if *timeout* seconds elapse.
        """
        deadline = time.monotonic() + timeout
        while True:
            status = self.get_status()
            if status.get("synced"):
                return status
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Node did not sync within {timeout}s")
            time.sleep(interval)


class AsyncNodeApi:
    """Asynchronous Node API."""

    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def get_status(self) -> dict[str, Any]:
        return await self._http.get("/api/node/status")

    async def get_peers(self, *, limit: int | None = None, offset: int | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return await self._http.get("/api/node/peers", params or None)

    async def get_config(self) -> dict[str, Any]:
        return await self._http.get("/api/node/config")

    async def wait_for_sync(
        self,
        *,
        interval: float = 2.0,
        timeout: float = 60.0,
    ) -> dict[str, Any]:
        import asyncio

        deadline = time.monotonic() + timeout
        while True:
            status = await self.get_status()
            if status.get("synced"):
                return status
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Node did not sync within {timeout}s")
            await asyncio.sleep(interval)
