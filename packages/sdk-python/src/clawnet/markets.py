"""Markets API — info, task, capability markets + disputes."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from clawnet.http import AsyncHttpClient, HttpClient


# ===========================================================================
# Synchronous
# ===========================================================================

class InfoMarketApi:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, **params: Any) -> dict[str, Any]:
        return self._http.get("/api/v1/markets/info", params or None)

    def get(self, listing_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/v1/markets/info/{quote(listing_id, safe='')}")

    def publish(self, **kwargs: Any) -> dict[str, Any]:
        return self._http.post("/api/v1/markets/info", kwargs)

    def get_content(self, listing_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/v1/markets/info/{quote(listing_id, safe='')}/content")

    def purchase(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/v1/markets/info/{quote(listing_id, safe='')}/actions/purchase", kwargs)

    def deliver(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        """Deliver purchased info content.

        Keyword Args:
            orderId (str): Order to deliver against.
            deliveryData (dict): Delivery envelope — should contain ``type``,
                ``format``, ``name``, ``contentHash``, ``size``, ``transport``.
                See :class:`~clawnet.types.InfoDeliverParams`.
            did, passphrase, nonce, prev, ts: standard EventFields.
        """
        return self._http.post(f"/api/v1/markets/info/{quote(listing_id, safe='')}/actions/deliver", kwargs)

    def confirm(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/v1/markets/info/{quote(listing_id, safe='')}/actions/confirm", kwargs)

    def review(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/v1/markets/info/{quote(listing_id, safe='')}/actions/review", kwargs)

    def remove(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/v1/markets/info/{quote(listing_id, safe='')}/actions/remove", kwargs)

    def subscribe(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/v1/markets/info/{quote(listing_id, safe='')}/subscriptions", kwargs)

    def unsubscribe(self, subscription_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/info/subscriptions/{quote(subscription_id, safe='')}/actions/cancel",
            kwargs,
        )

    def get_delivery(self, order_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/v1/markets/info/orders/{quote(order_id, safe='')}/delivery")


class TaskMarketApi:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, **params: Any) -> dict[str, Any]:
        return self._http.get("/api/v1/markets/tasks", params or None)

    def get(self, task_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/v1/markets/tasks/{quote(task_id, safe='')}")

    def publish(self, **kwargs: Any) -> dict[str, Any]:
        return self._http.post("/api/v1/markets/tasks", kwargs)

    def get_bids(self, task_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/v1/markets/tasks/{quote(task_id, safe='')}/bids")

    def bid(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/v1/markets/tasks/{quote(task_id, safe='')}/bids", kwargs)

    def accept_bid(self, task_id: str, bid_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/bids/{quote(bid_id, safe='')}/actions/accept",
            kwargs,
        )

    def reject_bid(self, task_id: str, bid_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/bids/{quote(bid_id, safe='')}/actions/reject",
            kwargs,
        )

    def withdraw_bid(self, task_id: str, bid_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/bids/{quote(bid_id, safe='')}/actions/withdraw",
            kwargs,
        )

    def deliver(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        """Submit task deliverables.

        Keyword Args:
            submission (dict): Legacy submission payload.
            message (str | None): Optional message.
            delivery (dict | None): ``{"envelope": {...}}`` — the
                :class:`~clawnet.types.DeliverableEnvelope` with ``type``,
                ``format``, ``name``, ``contentHash``, ``size``, ``transport``.
                See :class:`~clawnet.types.TaskDeliverParams`.
            did, passphrase, nonce, prev, ts: standard EventFields.
        """
        return self._http.post(f"/api/v1/markets/tasks/{quote(task_id, safe='')}/actions/deliver", kwargs)

    def confirm(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/v1/markets/tasks/{quote(task_id, safe='')}/actions/confirm", kwargs)

    def review(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/v1/markets/tasks/{quote(task_id, safe='')}/actions/review", kwargs)

    def remove(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/v1/markets/tasks/{quote(task_id, safe='')}/actions/remove", kwargs)


class CapabilityMarketApi:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, **params: Any) -> dict[str, Any]:
        return self._http.get("/api/v1/markets/capabilities", params or None)

    def get(self, listing_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/v1/markets/capabilities/{quote(listing_id, safe='')}")

    def publish(self, **kwargs: Any) -> dict[str, Any]:
        return self._http.post("/api/v1/markets/capabilities", kwargs)

    def lease(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/capabilities/{quote(listing_id, safe='')}/leases",
            kwargs,
        )

    def get_lease_detail(self, lease_id: str) -> dict[str, Any]:
        return self._http.get(
            f"/api/v1/markets/capabilities/leases/{quote(lease_id, safe='')}"
        )

    def invoke(self, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/capabilities/leases/{quote(lease_id, safe='')}/actions/invoke",
            kwargs,
        )

    def pause_lease(self, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/capabilities/leases/{quote(lease_id, safe='')}/actions/pause",
            kwargs,
        )

    def resume_lease(self, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/capabilities/leases/{quote(lease_id, safe='')}/actions/resume",
            kwargs,
        )

    def terminate_lease(self, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/capabilities/leases/{quote(lease_id, safe='')}/actions/terminate",
            kwargs,
        )

    def remove(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/capabilities/{quote(listing_id, safe='')}/actions/remove",
            kwargs,
        )


class MarketDisputeApi:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def open(self, order_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post("/api/v1/markets/disputes", {"orderId": order_id, **kwargs})

    def respond(self, dispute_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/disputes/{quote(dispute_id, safe='')}/actions/respond",
            kwargs,
        )

    def resolve(self, dispute_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/v1/markets/disputes/{quote(dispute_id, safe='')}/actions/resolve",
            kwargs,
        )


class MarketsApi:
    """Aggregates all market sub-APIs."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http
        self.info = InfoMarketApi(http)
        self.tasks = TaskMarketApi(http)
        self.capabilities = CapabilityMarketApi(http)
        self.disputes = MarketDisputeApi(http)

    def search(self, **params: Any) -> dict[str, Any]:
        """Search across all market types."""
        return self._http.get("/api/v1/markets/search", params or None)


# ===========================================================================
# Asynchronous
# ===========================================================================

class AsyncInfoMarketApi:
    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def list(self, **params: Any) -> dict[str, Any]:
        return await self._http.get("/api/v1/markets/info", params or None)

    async def get(self, listing_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/v1/markets/info/{quote(listing_id, safe='')}")

    async def publish(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/v1/markets/info", kwargs)

    async def get_content(self, listing_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/v1/markets/info/{quote(listing_id, safe='')}/content")

    async def purchase(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/info/{quote(listing_id, safe='')}/actions/purchase", kwargs
        )

    async def deliver(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        """Deliver purchased info content.

        Keyword Args:
            orderId (str): Order to deliver against.
            deliveryData (dict): Delivery envelope — should contain ``type``,
                ``format``, ``name``, ``contentHash``, ``size``, ``transport``.
                See :class:`~clawnet.types.InfoDeliverParams`.
            did, passphrase, nonce, prev, ts: standard EventFields.
        """
        return await self._http.post(
            f"/api/v1/markets/info/{quote(listing_id, safe='')}/actions/deliver", kwargs
        )

    async def confirm(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/info/{quote(listing_id, safe='')}/actions/confirm", kwargs
        )

    async def review(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/info/{quote(listing_id, safe='')}/actions/review", kwargs
        )

    async def remove(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/info/{quote(listing_id, safe='')}/actions/remove", kwargs
        )

    async def subscribe(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/info/{quote(listing_id, safe='')}/subscriptions", kwargs
        )

    async def unsubscribe(self, subscription_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/info/subscriptions/{quote(subscription_id, safe='')}/actions/cancel",
            kwargs,
        )

    async def get_delivery(self, order_id: str) -> dict[str, Any]:
        return await self._http.get(
            f"/api/v1/markets/info/orders/{quote(order_id, safe='')}/delivery"
        )


class AsyncTaskMarketApi:
    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def list(self, **params: Any) -> dict[str, Any]:
        return await self._http.get("/api/v1/markets/tasks", params or None)

    async def get(self, task_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/v1/markets/tasks/{quote(task_id, safe='')}")

    async def publish(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/v1/markets/tasks", kwargs)

    async def get_bids(self, task_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/v1/markets/tasks/{quote(task_id, safe='')}/bids")

    async def bid(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/bids", kwargs
        )

    async def accept_bid(self, task_id: str, bid_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/bids/{quote(bid_id, safe='')}/actions/accept",
            kwargs,
        )

    async def reject_bid(self, task_id: str, bid_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/bids/{quote(bid_id, safe='')}/actions/reject",
            kwargs,
        )

    async def withdraw_bid(self, task_id: str, bid_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/bids/{quote(bid_id, safe='')}/actions/withdraw",
            kwargs,
        )

    async def deliver(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        """Submit task deliverables.

        Keyword Args:
            submission (dict): Legacy submission payload.
            message (str | None): Optional message.
            delivery (dict | None): ``{"envelope": {...}}`` — the
                :class:`~clawnet.types.DeliverableEnvelope` with ``type``,
                ``format``, ``name``, ``contentHash``, ``size``, ``transport``.
                See :class:`~clawnet.types.TaskDeliverParams`.
            did, passphrase, nonce, prev, ts: standard EventFields.
        """
        return await self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/actions/deliver", kwargs
        )

    async def confirm(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/actions/confirm", kwargs
        )

    async def review(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/actions/review", kwargs
        )

    async def remove(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/tasks/{quote(task_id, safe='')}/actions/remove", kwargs
        )


class AsyncCapabilityMarketApi:
    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def list(self, **params: Any) -> dict[str, Any]:
        return await self._http.get("/api/v1/markets/capabilities", params or None)

    async def get(self, listing_id: str) -> dict[str, Any]:
        return await self._http.get(
            f"/api/v1/markets/capabilities/{quote(listing_id, safe='')}"
        )

    async def publish(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/v1/markets/capabilities", kwargs)

    async def lease(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/capabilities/{quote(listing_id, safe='')}/leases",
            kwargs,
        )

    async def get_lease_detail(self, lease_id: str) -> dict[str, Any]:
        return await self._http.get(
            f"/api/v1/markets/capabilities/leases/{quote(lease_id, safe='')}"
        )

    async def invoke(self, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/capabilities/leases/{quote(lease_id, safe='')}/actions/invoke",
            kwargs,
        )

    async def pause_lease(self, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/capabilities/leases/{quote(lease_id, safe='')}/actions/pause",
            kwargs,
        )

    async def resume_lease(self, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/capabilities/leases/{quote(lease_id, safe='')}/actions/resume",
            kwargs,
        )

    async def terminate_lease(self, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/capabilities/leases/{quote(lease_id, safe='')}/actions/terminate",
            kwargs,
        )

    async def remove(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/capabilities/{quote(listing_id, safe='')}/actions/remove",
            kwargs,
        )


class AsyncMarketDisputeApi:
    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def open(self, order_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            "/api/v1/markets/disputes", {"orderId": order_id, **kwargs}
        )

    async def respond(self, dispute_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/disputes/{quote(dispute_id, safe='')}/actions/respond",
            kwargs,
        )

    async def resolve(self, dispute_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/v1/markets/disputes/{quote(dispute_id, safe='')}/actions/resolve",
            kwargs,
        )


class AsyncMarketsApi:
    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http
        self.info = AsyncInfoMarketApi(http)
        self.tasks = AsyncTaskMarketApi(http)
        self.capabilities = AsyncCapabilityMarketApi(http)
        self.disputes = AsyncMarketDisputeApi(http)

    async def search(self, **params: Any) -> dict[str, Any]:
        return await self._http.get("/api/v1/markets/search", params or None)
