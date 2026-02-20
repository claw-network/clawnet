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
        return self._http.get("/api/markets/info", params or None)

    def get(self, listing_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/markets/info/{quote(listing_id, safe='')}")

    def publish(self, **kwargs: Any) -> dict[str, Any]:
        return self._http.post("/api/markets/info", kwargs)

    def get_content(self, listing_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/markets/info/{quote(listing_id, safe='')}/content")

    def purchase(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/info/{quote(listing_id, safe='')}/purchase", kwargs)

    def deliver(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/info/{quote(listing_id, safe='')}/deliver", kwargs)

    def confirm(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/info/{quote(listing_id, safe='')}/confirm", kwargs)

    def review(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/info/{quote(listing_id, safe='')}/review", kwargs)

    def remove(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.delete(f"/api/markets/info/{quote(listing_id, safe='')}")

    def subscribe(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/info/{quote(listing_id, safe='')}/subscribe", kwargs)

    def unsubscribe(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/info/{quote(listing_id, safe='')}/unsubscribe", kwargs)

    def get_delivery(self, order_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/markets/info/orders/{quote(order_id, safe='')}/delivery")


class TaskMarketApi:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, **params: Any) -> dict[str, Any]:
        return self._http.get("/api/markets/tasks", params or None)

    def get(self, task_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/markets/tasks/{quote(task_id, safe='')}")

    def publish(self, **kwargs: Any) -> dict[str, Any]:
        return self._http.post("/api/markets/tasks", kwargs)

    def get_bids(self, task_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/markets/tasks/{quote(task_id, safe='')}/bids")

    def bid(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/bids", kwargs)

    def accept_bid(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/accept", kwargs)

    def reject_bid(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/reject", kwargs)

    def withdraw_bid(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/withdraw", kwargs)

    def deliver(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/deliver", kwargs)

    def confirm(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/confirm", kwargs)

    def review(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/review", kwargs)

    def remove(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.delete(f"/api/markets/tasks/{quote(task_id, safe='')}")


class CapabilityMarketApi:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self, **params: Any) -> dict[str, Any]:
        return self._http.get("/api/markets/capabilities", params or None)

    def get(self, listing_id: str) -> dict[str, Any]:
        return self._http.get(f"/api/markets/capabilities/{quote(listing_id, safe='')}")

    def publish(self, **kwargs: Any) -> dict[str, Any]:
        return self._http.post("/api/markets/capabilities", kwargs)

    def lease(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(f"/api/markets/capabilities/{quote(listing_id, safe='')}/lease", kwargs)

    def get_lease_detail(self, listing_id: str, lease_id: str) -> dict[str, Any]:
        return self._http.get(
            f"/api/markets/capabilities/{quote(listing_id, safe='')}/leases/{quote(lease_id, safe='')}"
        )

    def invoke(self, listing_id: str, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/markets/capabilities/{quote(listing_id, safe='')}/leases/{quote(lease_id, safe='')}/invoke",
            kwargs,
        )

    def pause_lease(self, listing_id: str, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/markets/capabilities/{quote(listing_id, safe='')}/leases/{quote(lease_id, safe='')}/pause",
            kwargs,
        )

    def resume_lease(self, listing_id: str, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/markets/capabilities/{quote(listing_id, safe='')}/leases/{quote(lease_id, safe='')}/resume",
            kwargs,
        )

    def terminate_lease(self, listing_id: str, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/markets/capabilities/{quote(listing_id, safe='')}/leases/{quote(lease_id, safe='')}/terminate",
            kwargs,
        )

    def remove(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.delete(f"/api/markets/capabilities/{quote(listing_id, safe='')}")


class MarketDisputeApi:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def open(self, market_type: str, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/markets/{quote(market_type, safe='')}/{quote(listing_id, safe='')}/dispute",
            kwargs,
        )

    def respond(self, market_type: str, listing_id: str, dispute_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/markets/{quote(market_type, safe='')}/{quote(listing_id, safe='')}/dispute/{quote(dispute_id, safe='')}/respond",
            kwargs,
        )

    def resolve(self, market_type: str, listing_id: str, dispute_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._http.post(
            f"/api/markets/{quote(market_type, safe='')}/{quote(listing_id, safe='')}/dispute/{quote(dispute_id, safe='')}/resolve",
            kwargs,
        )


class MarketsApi:
    """Aggregates all market sub-APIs."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http
        self.info = InfoMarketApi(http)
        self.task = TaskMarketApi(http)
        self.capability = CapabilityMarketApi(http)
        self.dispute = MarketDisputeApi(http)

    def search(self, **params: Any) -> dict[str, Any]:
        """Search across all market types."""
        return self._http.get("/api/markets/search", params or None)


# ===========================================================================
# Asynchronous
# ===========================================================================

class AsyncInfoMarketApi:
    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def list(self, **params: Any) -> dict[str, Any]:
        return await self._http.get("/api/markets/info", params or None)

    async def get(self, listing_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/markets/info/{quote(listing_id, safe='')}")

    async def publish(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/markets/info", kwargs)

    async def purchase(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/markets/info/{quote(listing_id, safe='')}/purchase", kwargs)

    async def deliver(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/markets/info/{quote(listing_id, safe='')}/deliver", kwargs)

    async def confirm(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/markets/info/{quote(listing_id, safe='')}/confirm", kwargs)

    async def review(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/markets/info/{quote(listing_id, safe='')}/review", kwargs)

    async def remove(self, listing_id: str) -> dict[str, Any]:
        return await self._http.delete(f"/api/markets/info/{quote(listing_id, safe='')}")


class AsyncTaskMarketApi:
    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def list(self, **params: Any) -> dict[str, Any]:
        return await self._http.get("/api/markets/tasks", params or None)

    async def get(self, task_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/markets/tasks/{quote(task_id, safe='')}")

    async def publish(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/markets/tasks", kwargs)

    async def bid(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/bids", kwargs)

    async def accept_bid(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/accept", kwargs)

    async def deliver(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/deliver", kwargs)

    async def confirm(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/confirm", kwargs)

    async def review(self, task_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/markets/tasks/{quote(task_id, safe='')}/review", kwargs)

    async def remove(self, task_id: str) -> dict[str, Any]:
        return await self._http.delete(f"/api/markets/tasks/{quote(task_id, safe='')}")


class AsyncCapabilityMarketApi:
    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def list(self, **params: Any) -> dict[str, Any]:
        return await self._http.get("/api/markets/capabilities", params or None)

    async def get(self, listing_id: str) -> dict[str, Any]:
        return await self._http.get(f"/api/markets/capabilities/{quote(listing_id, safe='')}")

    async def publish(self, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post("/api/markets/capabilities", kwargs)

    async def lease(self, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(f"/api/markets/capabilities/{quote(listing_id, safe='')}/lease", kwargs)

    async def invoke(self, listing_id: str, lease_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/markets/capabilities/{quote(listing_id, safe='')}/leases/{quote(lease_id, safe='')}/invoke",
            kwargs,
        )

    async def remove(self, listing_id: str) -> dict[str, Any]:
        return await self._http.delete(f"/api/markets/capabilities/{quote(listing_id, safe='')}")


class AsyncMarketDisputeApi:
    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http

    async def open(self, market_type: str, listing_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/markets/{quote(market_type, safe='')}/{quote(listing_id, safe='')}/dispute",
            kwargs,
        )

    async def resolve(self, market_type: str, listing_id: str, dispute_id: str, **kwargs: Any) -> dict[str, Any]:
        return await self._http.post(
            f"/api/markets/{quote(market_type, safe='')}/{quote(listing_id, safe='')}/dispute/{quote(dispute_id, safe='')}/resolve",
            kwargs,
        )


class AsyncMarketsApi:
    def __init__(self, http: AsyncHttpClient) -> None:
        self._http = http
        self.info = AsyncInfoMarketApi(http)
        self.task = AsyncTaskMarketApi(http)
        self.capability = AsyncCapabilityMarketApi(http)
        self.dispute = AsyncMarketDisputeApi(http)

    async def search(self, **params: Any) -> dict[str, Any]:
        return await self._http.get("/api/markets/search", params or None)
