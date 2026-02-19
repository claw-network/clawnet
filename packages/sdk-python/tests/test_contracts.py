"""Tests for ContractsApi."""

from pytest_httpserver import HTTPServer

from clawtoken.client import ClawTokenClient


EF = {"did": "did:claw:z6MkA", "passphrase": "pass", "nonce": 1}


class TestContractsApi:
    def test_create(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts", method="POST").respond_with_json({
            "contractId": "ct-1", "txHash": "tx-ct",
        }, status=201)
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.create(
            **EF,
            provider="did:claw:z6MkB",
            terms={"title": "Website", "deliverables": ["site"]},
            payment={"type": "fixed", "totalAmount": 200},
        )
        assert result["contractId"] == "ct-1"

    def test_list(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts").respond_with_json({
            "contracts": [{"id": "ct-1", "status": "active"}], "total": 1,
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.list(status="active")
        assert result["total"] == 1

    def test_get(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts/ct-1").respond_with_json({
            "id": "ct-1", "status": "pending_signature",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.get("ct-1")
        assert result["status"] == "pending_signature"

    def test_sign(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts/ct-1/sign", method="POST").respond_with_json({
            "txHash": "tx-sign",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.sign("ct-1", **EF)
        assert result["txHash"] == "tx-sign"

    def test_fund(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts/ct-1/fund", method="POST").respond_with_json({
            "txHash": "tx-fund",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.fund("ct-1", **EF, amount=200)
        assert result["txHash"] == "tx-fund"

    def test_complete(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts/ct-1/complete", method="POST").respond_with_json({
            "txHash": "tx-complete",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.complete("ct-1", **EF)
        assert result["txHash"] == "tx-complete"

    def test_submit_milestone(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts/ct-1/milestones/ms-1/submit", method="POST").respond_with_json({
            "txHash": "tx-ms-submit",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.submit_milestone("ct-1", "ms-1", **EF, deliverables=["report.pdf"])
        assert result["txHash"] == "tx-ms-submit"

    def test_approve_milestone(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts/ct-1/milestones/ms-1/approve", method="POST").respond_with_json({
            "txHash": "tx-ms-approve",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.approve_milestone("ct-1", "ms-1", **EF)
        assert result["txHash"] == "tx-ms-approve"

    def test_reject_milestone(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts/ct-1/milestones/ms-1/reject", method="POST").respond_with_json({
            "txHash": "tx-ms-reject",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.reject_milestone("ct-1", "ms-1", **EF, reason="Missing deliverable")
        assert result["txHash"] == "tx-ms-reject"

    def test_open_dispute(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts/ct-1/dispute", method="POST").respond_with_json({
            "txHash": "tx-dispute",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.open_dispute("ct-1", **EF, reason="Work not delivered")
        assert result["txHash"] == "tx-dispute"

    def test_resolve_dispute(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts/ct-1/dispute/resolve", method="POST").respond_with_json({
            "txHash": "tx-resolve",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.resolve_dispute("ct-1", **EF, decision="Partial refund", clientRefund=100, providerPayment=100)
        assert result["txHash"] == "tx-resolve"

    def test_settlement(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/contracts/ct-1/settlement", method="POST").respond_with_json({
            "txHash": "tx-settle",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.contracts.settlement("ct-1", **EF)
        assert result["txHash"] == "tx-settle"
