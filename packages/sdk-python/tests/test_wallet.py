"""Tests for WalletApi."""

from pytest_httpserver import HTTPServer

from clawnet.client import ClawNetClient


class TestWalletApi:
    def test_get_balance(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/wallet/balance").respond_with_json({
            "balance": 1000, "available": 900, "pending": 50, "locked": 50,
        })
        client = ClawNetClient(httpserver.url_for(""))
        balance = client.wallet.get_balance()
        assert balance["available"] == 900

    def test_get_balance_with_did(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/wallet/balance", query_string="did=did%3Aclaw%3Az6MkX").respond_with_json({
            "balance": 500, "available": 500, "pending": 0, "locked": 0,
        })
        client = ClawNetClient(httpserver.url_for(""))
        balance = client.wallet.get_balance(did="did:claw:z6MkX")
        assert balance["balance"] == 500

    def test_transfer(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/wallet/transfer", method="POST").respond_with_json({
            "txHash": "tx-1", "from": "did:claw:z6MkA", "to": "did:claw:z6MkB",
            "amount": 100, "status": "confirmed", "timestamp": 1700000000000,
        })
        client = ClawNetClient(httpserver.url_for(""))
        result = client.wallet.transfer(
            did="did:claw:z6MkA", passphrase="pass", nonce=1,
            to="did:claw:z6MkB", amount=100,
        )
        assert result["txHash"] == "tx-1"
        assert result["amount"] == 100

    def test_get_history(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/wallet/history").respond_with_json({
            "transactions": [], "total": 0, "hasMore": False,
        })
        client = ClawNetClient(httpserver.url_for(""))
        history = client.wallet.get_history(limit=10)
        assert history["total"] == 0

    def test_create_escrow(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/wallet/escrow", method="POST").respond_with_json({
            "id": "esc-1", "depositor": "d", "beneficiary": "b",
            "amount": 100, "funded": 0, "released": 0, "status": "created",
            "releaseRules": [], "createdAt": 1700000000000,
        })
        client = ClawNetClient(httpserver.url_for(""))
        result = client.wallet.create_escrow(
            did="d", passphrase="p", nonce=1, beneficiary="b", amount=100,
            releaseRules=[{"type": "manual"}],
        )
        assert result["id"] == "esc-1"

    def test_get_escrow(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/wallet/escrow/esc-1").respond_with_json({
            "id": "esc-1", "status": "funded",
        })
        client = ClawNetClient(httpserver.url_for(""))
        result = client.wallet.get_escrow("esc-1")
        assert result["status"] == "funded"

    def test_release_escrow(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/wallet/escrow/esc-1/release", method="POST").respond_with_json({
            "txHash": "tx-release",
        })
        client = ClawNetClient(httpserver.url_for(""))
        result = client.wallet.release_escrow("esc-1", did="d", passphrase="p", nonce=1, amount=50, resourcePrev="prev")
        assert result["txHash"] == "tx-release"

    def test_fund_escrow(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/wallet/escrow/esc-1/fund", method="POST").respond_with_json({
            "txHash": "tx-fund",
        })
        client = ClawNetClient(httpserver.url_for(""))
        result = client.wallet.fund_escrow("esc-1", did="d", passphrase="p", nonce=1, amount=50, resourcePrev="prev")
        assert result["txHash"] == "tx-fund"

    def test_refund_escrow(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/wallet/escrow/esc-1/refund", method="POST").respond_with_json({
            "txHash": "tx-refund",
        })
        client = ClawNetClient(httpserver.url_for(""))
        result = client.wallet.refund_escrow("esc-1", did="d", passphrase="p", nonce=1, amount=50, resourcePrev="prev")
        assert result["txHash"] == "tx-refund"
