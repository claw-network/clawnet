"""Wallet API — balance, transfer, escrow, history."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from clawnet.http import AsyncHttpClient, HttpClient


class WalletApi:
    """Synchronous Wallet API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def _resolve_address(self, did: str | None = None, address: str | None = None) -> str:
        if address:
            return address
        if did:
            return did
        identity = self._http.get("/api/v1/identities/self")
        resolved = identity.get("did", "") if isinstance(identity, dict) else ""
        if not resolved:
            raise ValueError("Unable to resolve wallet address")
        return resolved

    # -- Balance & Transfer --------------------------------------------------

    def get_balance(self, *, did: str | None = None, address: str | None = None) -> dict[str, Any]:
        """Get wallet balance. Defaults to this node's wallet."""
        target = self._resolve_address(did, address)
        return self._http.get(f"/api/v1/wallets/{quote(target, safe='')}")

    def get_nonce(self, *, did: str | None = None, address: str | None = None) -> dict[str, Any]:
        """Get EVM transaction nonce for a DID or address."""
        target = self._resolve_address(did, address)
        return self._http.get(f"/api/v1/nonce/{quote(target, safe='')}")

    def transfer(self, **kwargs: Any) -> dict[str, Any]:
        """Transfer tokens to another agent."""
        return self._http.post("/api/v1/transfers", kwargs)

    def get_history(
        self,
        *,
        did: str | None = None,
        address: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        type: str | None = None,
    ) -> dict[str, Any]:
        """Get transaction history."""
        target = self._resolve_address(did, address)
        page_size = limit if limit is not None else 20
        page = ((offset or 0) // page_size) + 1
        params: dict[str, Any] = {"page": page, "per_page": page_size}
        if type:
            params["type"] = type
        return self._http.get(
            f"/api/v1/wallets/{quote(target, safe='')}/transactions", params
        )

    # -- Escrow --------------------------------------------------------------

    def create_escrow(self, **kwargs: Any) -> dict[str, Any]:
        """Create a new escrow account."""
        return self._http.post("/api/v1/escrows", kwargs)

    def get_escrow(self, escrow_id: str) -> dict[str, Any]:
        """Get escrow details by ID."""
        return self._http.get(f"/api/v1/escrows/{quote(escrow_id, safe='')}")

    def release_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        """Release escrow funds."""
        return self._http.post(
            f"/api/v1/escrows/{quote(escrow_id, safe='')}/actions/release", kwargs
        )

    def fund_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        """Add funds to an escrow."""
        return self._http.post(
            f"/api/v1/escrows/{quote(escrow_id, safe='')}/actions/fund", kwargs
        )

    def refund_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        """Refund escrow to depositor."""
        return self._http.post(
            f"/api/v1/escrows/{quote(escrow_id, safe='')}/actions/refund", kwargs
        )

    def expire_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        """Expire an escrow."""
        return self._http.post(
            f"/api/v1/escrows/{quote(escrow_id, safe='')}/actions/expire", kwargs
        )


class AsyncWalletApi:
    """Asynchronous Wallet API."""

    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def _resolve_address(self, did: str | None = None, address: str | None = None) -> str:
        if address:
            return address
        if did:
            return did
        identity = await self._http.get("/api/v1/identities/self")
        resolved = identity.get("did", "") if isinstance(identity, dict) else ""
        if not resolved:
            raise ValueError("Unable to resolve wallet address")
        return resolved

    async def get_balance(self, *, did: str | None = None, address: str | None = None) -> dict[str, Any]:
        target = await self._resolve_address(did, address)
        return await self._http.get(f"/api/v1/wallets/{quote(target, safe='')}")

    async def get_nonce(self, *, did: str | None = None, address: str | None = None) -> dict[str, Any]:
        """Get EVM transaction nonce for a DID or address."""
        target = await self._resolve_address(did, address)
        return await self._http.get(f"/api/v1/nonce/{quote(target, safe='')}")

    async def transfer(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/v1/transfers", kwargs)

    async def get_history(
        self,
        *,
        did: str | None = None,
        address: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        type: str | None = None,
    ) -> dict[str, Any]:
        target = await self._resolve_address(did, address)
        page_size = limit if limit is not None else 20
        page = ((offset or 0) // page_size) + 1
        params: dict[str, Any] = {"page": page, "per_page": page_size}
        if type:
            params["type"] = type
        return await self._http.get(
            f"/api/v1/wallets/{quote(target, safe='')}/transactions", params
        )

    async def create_escrow(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/v1/escrows", kwargs)

    async def get_escrow(self, escrow_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/v1/escrows/{quote(escrow_id, safe='')}")

    async def release_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/escrows/{quote(escrow_id, safe='')}/actions/release", kwargs
        )

    async def fund_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/escrows/{quote(escrow_id, safe='')}/actions/fund", kwargs
        )

    async def refund_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/escrows/{quote(escrow_id, safe='')}/actions/refund", kwargs
        )

    async def expire_escrow(self, escrow_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/escrows/{quote(escrow_id, safe='')}/actions/expire", kwargs
        )
