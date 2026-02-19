"""Contracts API — create, sign, fund, milestones, disputes, settlement."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from clawtoken.http import AsyncHttpClient, HttpClient


class ContractsApi:
    """Synchronous Contracts API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, **params: Any) -> dict[str, Any]:
        """List contracts (with optional filters)."""
        return self._http.get("/api/contracts", params or None)

    def get(self, contract_id: str) -> dict[str, Any]:
        """Get contract by ID."""
        return self._http.get(f"/api/contracts/{quote(contract_id, safe='')}")

    def create(self, **kwargs: Any) -> dict[str, Any]:
        """Create a new service contract."""
        return self._http.post("/api/contracts", kwargs)

    def sign(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Sign a contract."""
        return self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/sign", kwargs)

    def fund(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Fund a contract."""
        return self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/fund", kwargs)

    def complete(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Complete a contract."""
        return self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/complete", kwargs)

    # -- Milestones ----------------------------------------------------------

    def submit_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        """Submit a milestone deliverable."""
        return self._http.post(
            f"/api/contracts/{quote(contract_id, safe='')}/milestones/{quote(milestone_id, safe='')}/submit",
            kwargs,
        )

    def approve_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        """Approve a submitted milestone."""
        return self._http.post(
            f"/api/contracts/{quote(contract_id, safe='')}/milestones/{quote(milestone_id, safe='')}/approve",
            kwargs,
        )

    def reject_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        """Reject a submitted milestone."""
        return self._http.post(
            f"/api/contracts/{quote(contract_id, safe='')}/milestones/{quote(milestone_id, safe='')}/reject",
            kwargs,
        )

    # -- Disputes ------------------------------------------------------------

    def open_dispute(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Open a dispute on a contract."""
        return self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/dispute", kwargs)

    def resolve_dispute(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Resolve a contract dispute."""
        return self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/dispute/resolve", kwargs)

    # -- Settlement ----------------------------------------------------------

    def settlement(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Execute final settlement."""
        return self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/settlement", kwargs)


class AsyncContractsApi:
    """Asynchronous Contracts API."""

    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def list(self, **params: Any) -> dict[str, Any]:
        return await self._http.get("/api/contracts", params or None)

    async def get(self, contract_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/contracts/{quote(contract_id, safe='')}")

    async def create(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/contracts", kwargs)

    async def sign(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/sign", kwargs)

    async def fund(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/fund", kwargs)

    async def complete(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/complete", kwargs)

    async def submit_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/contracts/{quote(contract_id, safe='')}/milestones/{quote(milestone_id, safe='')}/submit",
            kwargs,
        )

    async def approve_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/contracts/{quote(contract_id, safe='')}/milestones/{quote(milestone_id, safe='')}/approve",
            kwargs,
        )

    async def reject_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/contracts/{quote(contract_id, safe='')}/milestones/{quote(milestone_id, safe='')}/reject",
            kwargs,
        )

    async def open_dispute(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/dispute", kwargs)

    async def resolve_dispute(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/dispute/resolve", kwargs)

    async def settlement(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/contracts/{quote(contract_id, safe='')}/settlement", kwargs)
