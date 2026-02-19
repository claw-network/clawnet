"""DAO Governance API — proposals, voting, delegation, treasury, timelock."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from clawtoken.http import AsyncHttpClient, HttpClient


class DaoApi:
    """Synchronous DAO Governance API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    # ── Proposals ──────────────────────────────────────────────────────

    def list_proposals(self, *, status: str | None = None) -> dict[str, Any]:
        """List proposals, optionally filtered by status."""
        params: dict[str, Any] | None = {"status": status} if status else None
        return self._http.get("/api/dao/proposals", params)

    def get_proposal(self, proposal_id: str) -> dict[str, Any]:
        """Get a single proposal by ID."""
        return self._http.get(f"/api/dao/proposals/{quote(proposal_id, safe='')}")

    def create_proposal(self, **kwargs: Any) -> dict[str, Any]:
        """Create a new proposal."""
        return self._http.post("/api/dao/proposals", kwargs)

    def advance_proposal(self, proposal_id: str, **kwargs: Any) -> dict[str, Any]:
        """Advance a proposal to a new status."""
        return self._http.post(
            f"/api/dao/proposals/{quote(proposal_id, safe='')}/advance", kwargs
        )

    # ── Voting ─────────────────────────────────────────────────────────

    def get_votes(self, proposal_id: str) -> dict[str, Any]:
        """Get votes for a proposal."""
        return self._http.get(
            f"/api/dao/proposals/{quote(proposal_id, safe='')}/votes"
        )

    def vote(self, **kwargs: Any) -> dict[str, Any]:
        """Cast a vote on a proposal."""
        return self._http.post("/api/dao/vote", kwargs)

    # ── Delegation ─────────────────────────────────────────────────────

    def delegate(self, **kwargs: Any) -> dict[str, Any]:
        """Set delegation to another DID."""
        return self._http.post("/api/dao/delegate", kwargs)

    def revoke_delegation(self, **kwargs: Any) -> dict[str, Any]:
        """Revoke a delegation."""
        return self._http.post("/api/dao/delegate/revoke", kwargs)

    def get_delegations(self, did: str) -> dict[str, Any]:
        """Get delegations for a DID."""
        return self._http.get(f"/api/dao/delegations/{quote(did, safe='')}")

    # ── Treasury ───────────────────────────────────────────────────────

    def get_treasury(self) -> dict[str, Any]:
        """Get current treasury status."""
        return self._http.get("/api/dao/treasury")

    def deposit(self, **kwargs: Any) -> dict[str, Any]:
        """Deposit into the treasury."""
        return self._http.post("/api/dao/treasury/deposit", kwargs)

    # ── Timelock ───────────────────────────────────────────────────────

    def list_timelock(self) -> dict[str, Any]:
        """List timelock entries."""
        return self._http.get("/api/dao/timelock")

    def execute_timelock(self, action_id: str, **kwargs: Any) -> dict[str, Any]:
        """Execute a timelocked action."""
        return self._http.post(
            f"/api/dao/timelock/{quote(action_id, safe='')}/execute", kwargs
        )

    def cancel_timelock(self, action_id: str, **kwargs: Any) -> dict[str, Any]:
        """Cancel a timelocked action."""
        return self._http.post(
            f"/api/dao/timelock/{quote(action_id, safe='')}/cancel", kwargs
        )

    # ── Params ─────────────────────────────────────────────────────────

    def get_params(self) -> dict[str, Any]:
        """Get governance parameters and thresholds."""
        return self._http.get("/api/dao/params")


class AsyncDaoApi:
    """Asynchronous DAO Governance API."""

    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    # ── Proposals ──────────────────────────────────────────────────────

    async def list_proposals(self, *, status: str | None = None) -> dict[str, Any]:
        """List proposals, optionally filtered by status."""
        params: dict[str, Any] | None = {"status": status} if status else None
        return await self._http.get("/api/dao/proposals", params)

    async def get_proposal(self, proposal_id: str) -> dict[str, Any]:
        """Get a single proposal by ID."""
        return await self._http.get(
            f"/api/dao/proposals/{quote(proposal_id, safe='')}"
        )

    async def create_proposal(self, **kwargs: Any) -> dict[str, Any]:
        """Create a new proposal."""
        return await self._http.post("/api/dao/proposals", kwargs)

    async def advance_proposal(self, proposal_id: str, **kwargs: Any) -> dict[str, Any]:
        """Advance a proposal to a new status."""
        return await self._http.post(
            f"/api/dao/proposals/{quote(proposal_id, safe='')}/advance", kwargs
        )

    # ── Voting ─────────────────────────────────────────────────────────

    async def get_votes(self, proposal_id: str) -> dict[str, Any]:
        """Get votes for a proposal."""
        return await self._http.get(
            f"/api/dao/proposals/{quote(proposal_id, safe='')}/votes"
        )

    async def vote(self, **kwargs: Any) -> dict[str, Any]:
        """Cast a vote on a proposal."""
        return await self._http.post("/api/dao/vote", kwargs)

    # ── Delegation ─────────────────────────────────────────────────────

    async def delegate(self, **kwargs: Any) -> dict[str, Any]:
        """Set delegation to another DID."""
        return await self._http.post("/api/dao/delegate", kwargs)

    async def revoke_delegation(self, **kwargs: Any) -> dict[str, Any]:
        """Revoke a delegation."""
        return await self._http.post("/api/dao/delegate/revoke", kwargs)

    async def get_delegations(self, did: str) -> dict[str, Any]:
        """Get delegations for a DID."""
        return await self._http.get(f"/api/dao/delegations/{quote(did, safe='')}")

    # ── Treasury ───────────────────────────────────────────────────────

    async def get_treasury(self) -> dict[str, Any]:
        """Get current treasury status."""
        return await self._http.get("/api/dao/treasury")

    async def deposit(self, **kwargs: Any) -> dict[str, Any]:
        """Deposit into the treasury."""
        return await self._http.post("/api/dao/treasury/deposit", kwargs)

    # ── Timelock ───────────────────────────────────────────────────────

    async def list_timelock(self) -> dict[str, Any]:
        """List timelock entries."""
        return await self._http.get("/api/dao/timelock")

    async def execute_timelock(self, action_id: str, **kwargs: Any) -> dict[str, Any]:
        """Execute a timelocked action."""
        return await self._http.post(
            f"/api/dao/timelock/{quote(action_id, safe='')}/execute", kwargs
        )

    async def cancel_timelock(self, action_id: str, **kwargs: Any) -> dict[str, Any]:
        """Cancel a timelocked action."""
        return await self._http.post(
            f"/api/dao/timelock/{quote(action_id, safe='')}/cancel", kwargs
        )

    # ── Params ─────────────────────────────────────────────────────────

    async def get_params(self) -> dict[str, Any]:
        """Get governance parameters and thresholds."""
        return await self._http.get("/api/dao/params")
