"""Contracts API — create, sign, fund, milestones, disputes, settlement."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from clawnet.http import AsyncHttpClient, HttpClient


class ContractsApi:
    """Synchronous Contracts API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, **params: Any) -> dict[str, Any]:
        """List contracts (with optional filters)."""
        return self._http.get("/api/v1/contracts", params or None)

    def get(self, contract_id: str) -> dict[str, Any]:
        """Get contract by ID."""
        return self._http.get(f"/api/v1/contracts/{quote(contract_id, safe='')}")

    def create(self, **kwargs: Any) -> dict[str, Any]:
        """Create a new service contract."""
        return self._http.post("/api/v1/contracts", kwargs)

    def sign(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Sign a contract."""
        return self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/sign", kwargs
        )

    def fund(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Fund a contract (lock escrow)."""
        return self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/activate", kwargs
        )

    def complete(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Mark contract as completed."""
        return self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/complete", kwargs
        )

    # -- Milestones ----------------------------------------------------------

    def submit_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        """Submit a milestone deliverable.

        Keyword Args:
            deliverables (list[str] | None): Legacy deliverable URLs/hashes.
            message (str | None): Optional message.
            envelopeDigest (str | None): ``BLAKE3(JCS(envelope))`` hex — bypasses
                legacy keccak256 path.
            delivery (dict | None): ``{"envelope": {...}}`` — the
                :class:`~clawnet.types.DeliverableEnvelope` with ``type``,
                ``format``, ``name``, ``contentHash``, ``size``, ``transport``.
                See :class:`~clawnet.types.MilestoneSubmitParams`.
            did, passphrase, nonce, prev, ts: standard EventFields.
        """
        return self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}"
            f"/milestones/{quote(milestone_id, safe='')}/actions/submit",
            kwargs,
        )

    def approve_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        """Approve a submitted milestone."""
        return self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}"
            f"/milestones/{quote(milestone_id, safe='')}/actions/approve",
            kwargs,
        )

    def reject_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        """Reject a submitted milestone."""
        return self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}"
            f"/milestones/{quote(milestone_id, safe='')}/actions/reject",
            kwargs,
        )

    # -- Disputes ------------------------------------------------------------

    def open_dispute(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Open a dispute on a contract."""
        return self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/dispute", kwargs
        )

    def resolve_dispute(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Resolve a contract dispute."""
        return self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/resolve", kwargs
        )

    # -- Settlement ----------------------------------------------------------

    def settlement(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        """Execute final settlement (terminate)."""
        return self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/terminate", kwargs
        )


class AsyncContractsApi:
    """Asynchronous Contracts API."""

    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def list(self, **params: Any) -> dict[str, Any]:
        return await self._http.get("/api/v1/contracts", params or None)

    async def get(self, contract_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/v1/contracts/{quote(contract_id, safe='')}")

    async def create(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/v1/contracts", kwargs)

    async def sign(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/sign", kwargs
        )

    async def fund(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/activate", kwargs
        )

    async def complete(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/complete", kwargs
        )

    async def submit_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        """Submit a milestone deliverable.

        Keyword Args:
            deliverables (list[str] | None): Legacy deliverable URLs/hashes.
            message (str | None): Optional message.
            envelopeDigest (str | None): ``BLAKE3(JCS(envelope))`` hex — bypasses
                legacy keccak256 path.
            delivery (dict | None): ``{"envelope": {...}}`` — the
                :class:`~clawnet.types.DeliverableEnvelope` with ``type``,
                ``format``, ``name``, ``contentHash``, ``size``, ``transport``.
                See :class:`~clawnet.types.MilestoneSubmitParams`.
            did, passphrase, nonce, prev, ts: standard EventFields.
        """
        return await self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}"
            f"/milestones/{quote(milestone_id, safe='')}/actions/submit",
            kwargs,
        )

    async def approve_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}"
            f"/milestones/{quote(milestone_id, safe='')}/actions/approve",
            kwargs,
        )

    async def reject_milestone(self, contract_id: str, milestone_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}"
            f"/milestones/{quote(milestone_id, safe='')}/actions/reject",
            kwargs,
        )

    async def open_dispute(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/dispute", kwargs
        )

    async def resolve_dispute(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/resolve", kwargs
        )

    async def settlement(self, contract_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/contracts/{quote(contract_id, safe='')}/actions/terminate", kwargs
        )
