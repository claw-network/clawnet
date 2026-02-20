"""Wallet API — balance, transfer, escrow, history."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from clawnet.http import AsyncHttpClient, HttpClient


class WalletApi:
    """Synchronous Wallet API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    # -- Balance & Transfer --------------------------------------------------

    def get_balance(self, *, did: str | None = None, address: str | None = None) -> dict[str, Any]:
        """Get wallet balance. Defaults to this node's wallet."""
        params: dict[str, Any] = {}
        if did:
            params["did"] = did
        if address:
            params["address"] = address
        return self._http.get("/api/wallet/balance", params or None)

    def transfer(self, **kwargs: Any) -> dict[str, Any]:
        """Transfer tokens to another agent."""
        return self._http.post("/api/wallet/transfer", kwargs)

    def get_history(
        self,
        *,
        did: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        type: str | None = None,
    ) -> dict[str, Any]:
        """Get transaction history."""
        params: dict[str, Any] = {}
        if did:
            params["did"] = did
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        if type:
            params["type"] = type
        return self._http.get("/api/wallet/history", params or None)

    # -- Escrow --------------------------------------------------------------

    def create_escrow(self, **kwargs: Any) -> dict[str, Any]:
        """Create a new escrow account."""
        return self._http.post("/api/wallet/escrow", kwargs)

    def get_escrow(self, escrow_id: str) -> dict[str, Any]:
        """Get escrow details by ID."""
        return self._http.get(f"/api/wallet/escrow/{quote(escrow_id, safe='')}")

    def release_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        """Release escrow funds."""
        return self._http.post(f"/api/wallet/escrow/{quote(escrow_id, safe='')}/release", kwargs)

    def fund_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        """Add funds to an escrow."""
        return self._http.post(f"/api/wallet/escrow/{quote(escrow_id, safe='')}/fund", kwargs)

    def refund_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        """Refund escrow to depositor."""
        return self._http.post(f"/api/wallet/escrow/{quote(escrow_id, safe='')}/refund", kwargs)

    def expire_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        """Expire an escrow."""
        return self._http.post(f"/api/wallet/escrow/{quote(escrow_id, safe='')}/expire", kwargs)


class AsyncWalletApi:
    """Asynchronous Wallet API."""

    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def get_balance(self, *, did: str | None = None, address: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if did:
            params["did"] = did
        if address:
            params["address"] = address
        return await self._http.get("/api/wallet/balance", params or None)

    async def transfer(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/wallet/transfer", kwargs)

    async def get_history(
        self,
        *,
        did: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        type: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if did:
            params["did"] = did
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        if type:
            params["type"] = type
        return await self._http.get("/api/wallet/history", params or None)

    async def create_escrow(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/wallet/escrow", kwargs)

    async def get_escrow(self, escrow_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/wallet/escrow/{quote(escrow_id, safe='')}")

    async def release_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/wallet/escrow/{quote(escrow_id, safe='')}/release", kwargs)

    async def fund_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/wallet/escrow/{quote(escrow_id, safe='')}/fund", kwargs)

    async def refund_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/wallet/escrow/{quote(escrow_id, safe='')}/refund", kwargs)

    async def expire_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/wallet/escrow/{quote(escrow_id, safe='')}/expire", kwargs)
