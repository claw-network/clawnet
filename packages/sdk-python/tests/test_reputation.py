"""Tests for ReputationApi."""

from pytest_httpserver import HTTPServer

from clawtoken.client import ClawTokenClient


class TestReputationApi:
    def test_get_profile(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/reputation/did:claw:z6MkTest").respond_with_json({
            "did": "did:claw:z6MkTest", "score": 85.0, "level": "Gold",
            "levelNumber": 4, "dimensions": {}, "totalTransactions": 10,
            "successRate": 0.95, "averageRating": 4.5,
        })
        client = ClawTokenClient(httpserver.url_for(""))
        profile = client.reputation.get_profile("did:claw:z6MkTest")
        assert profile["score"] == 85.0
        assert profile["level"] == "Gold"

    def test_get_reviews(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/reputation/did:claw:z6MkTest/reviews").respond_with_json({
            "reviews": [{"id": "r-1", "reviewer": "did:claw:z6MkA", "reviewee": "did:claw:z6MkTest",
                         "rating": 5, "createdAt": 1700000000000}],
            "total": 1, "averageRating": 5.0,
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.reputation.get_reviews("did:claw:z6MkTest")
        assert result["total"] == 1
        assert result["reviews"][0]["rating"] == 5

    def test_record(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/reputation/record", method="POST").respond_with_json({
            "txHash": "tx-rep", "status": "recorded", "timestamp": 1700000000000,
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.reputation.record(
            did="did:claw:z6MkA", passphrase="pass", nonce=1,
            target="did:claw:z6MkB", dimension="quality", score=5, ref="ct-1",
        )
        assert result["txHash"] == "tx-rep"
