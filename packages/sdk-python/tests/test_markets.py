"""Tests for MarketsApi."""

from pytest_httpserver import HTTPServer

from clawnet.client import ClawNetClient


class TestMarketsSearch:
    def test_search(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/v1/markets/search").respond_with_json({
            "listings": [{"id": "ls-1", "type": "task", "seller": "did:claw:z6MkA", "title": "Data"}],
            "total": 1,
        })
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.search(q="data", type="task")
        assert result["total"] == 1


class TestInfoMarket:
    def test_list(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/v1/markets/info").respond_with_json({"items": [], "total": 0})
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.info.list()
        assert result["total"] == 0

    def test_publish(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/v1/markets/info", method="POST").respond_with_json({
            "listingId": "info-1", "txHash": "tx-info",
        }, status=201)
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.info.publish(
            did="d", passphrase="p", nonce=1, title="Dataset",
            infoType="dataset", contentFormat="csv",
            pricing={"model": "one_time", "basePrice": 10},
        )
        assert result["listingId"] == "info-1"

    def test_purchase(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request(
            "/api/v1/markets/info/info-1/actions/purchase", method="POST"
        ).respond_with_json({"orderId": "ord-1", "txHash": "tx-purchase"})
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.info.purchase("info-1", did="d", passphrase="p", nonce=1)
        assert result["orderId"] == "ord-1"


class TestTaskMarket:
    def test_publish(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/v1/markets/tasks", method="POST").respond_with_json({
            "listingId": "task-1", "txHash": "tx-task",
        }, status=201)
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.tasks.publish(
            did="d", passphrase="p", nonce=1, title="Analysis",
            taskType="data-analysis", pricing={"model": "fixed", "basePrice": 50},
        )
        assert result["listingId"] == "task-1"

    def test_bid(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/v1/markets/tasks/task-1/bids", method="POST").respond_with_json({
            "bidId": "bid-1", "txHash": "tx-bid",
        })
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.tasks.bid("task-1", did="d", passphrase="p", nonce=1, amount=40)
        assert result["bidId"] == "bid-1"

    def test_accept_bid(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request(
            "/api/v1/markets/tasks/task-1/bids/bid-1/actions/accept", method="POST"
        ).respond_with_json({"txHash": "tx-accept"})
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.tasks.accept_bid("task-1", "bid-1", did="d", passphrase="p", nonce=1)
        assert result["txHash"] == "tx-accept"

    def test_deliver(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request(
            "/api/v1/markets/tasks/task-1/actions/deliver", method="POST"
        ).respond_with_json({"txHash": "tx-deliver"})
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.tasks.deliver("task-1", did="d", passphrase="p", nonce=1, submission={"file": "report.pdf"})
        assert result["txHash"] == "tx-deliver"


class TestCapabilityMarket:
    def test_publish(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/v1/markets/capabilities", method="POST").respond_with_json({
            "listingId": "cap-1", "txHash": "tx-cap",
        }, status=201)
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.capabilities.publish(
            did="d", passphrase="p", nonce=1, title="NLP API",
            capabilityType="nlp", pricing={"model": "pay_per_use", "basePrice": 1},
        )
        assert result["listingId"] == "cap-1"

    def test_lease(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request(
            "/api/v1/markets/capabilities/cap-1/leases", method="POST"
        ).respond_with_json({"leaseId": "lease-1", "txHash": "tx-lease"})
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.capabilities.lease(
            "cap-1", did="d", passphrase="p", nonce=1, plan={"type": "pay_per_use"},
        )
        assert result["leaseId"] == "lease-1"

    def test_invoke(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request(
            "/api/v1/markets/capabilities/leases/lease-1/actions/invoke", method="POST"
        ).respond_with_json({
            "leaseId": "lease-1", "txHash": "tx-invoke",
            "usage": {"id": "u-1", "leaseId": "lease-1", "resource": "/summarize",
                      "success": True, "timestamp": 1700000000000},
        })
        client = ClawNetClient(httpserver.url_for(""))
        result = client.markets.capabilities.invoke(
            "lease-1", did="d", passphrase="p", nonce=1,
            resource="/summarize", latency=100, success=True,
        )
        assert result["txHash"] == "tx-invoke"
