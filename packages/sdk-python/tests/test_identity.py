"""Tests for IdentityApi."""

from pytest_httpserver import HTTPServer

from clawtoken.client import ClawTokenClient


class TestIdentityApi:
    def test_get(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/identity/did:claw:z6MkTest").respond_with_json({
            "did": "did:claw:z6MkTest", "publicKey": "pk-abc", "created": 1700000000000, "updated": 1700000000000,
        })
        client = ClawTokenClient(httpserver.url_for(""))
        identity = client.identity.get("did:claw:z6MkTest")
        assert identity["did"] == "did:claw:z6MkTest"

    def test_resolve_with_source(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request(
            "/api/identity/did:claw:z6MkTest", query_string="source=log"
        ).respond_with_json({"did": "did:claw:z6MkTest", "publicKey": "pk-abc"})
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.identity.resolve("did:claw:z6MkTest", source="log")
        assert result["publicKey"] == "pk-abc"

    def test_list_capabilities(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/identity/capabilities").respond_with_json({
            "capabilities": [{"type": "nlp", "name": "Summarizer"}],
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.identity.list_capabilities("did:claw:z6MkTest")
        assert len(result["capabilities"]) == 1

    def test_register_capability(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/identity/capabilities", method="POST").respond_with_json({
            "txHash": "tx-cap",
        })
        client = ClawTokenClient(httpserver.url_for(""))
        result = client.identity.register_capability(
            did="did:claw:z6MkTest", passphrase="pass", nonce=1,
            credential={"type": "nlp", "name": "Summarizer"},
        )
        assert result["txHash"] == "tx-cap"
