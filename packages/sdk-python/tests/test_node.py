"""Tests for NodeApi."""

from pytest_httpserver import HTTPServer

from clawtoken.client import ClawTokenClient


class TestNodeApi:
    def test_get_status(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/node/status").respond_with_json({
            "did": "did:claw:z6MkNode", "synced": True, "blockHeight": 100,
            "peers": 5, "network": "testnet", "version": "0.1.0", "uptime": 3600,
        })
        client = ClawTokenClient(httpserver.url_for(""))
        status = client.node.get_status()
        assert status["synced"] is True
        assert status["blockHeight"] == 100

    def test_get_peers(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/node/peers").respond_with_json({
            "peers": [{"peerId": "peer-1", "multiaddrs": ["/ip4/127.0.0.1/tcp/9527"]}],
            "total": 1,
        })
        client = ClawTokenClient(httpserver.url_for(""))
        peers = client.node.get_peers()
        assert peers["total"] == 1

    def test_get_config(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/node/config").respond_with_json({"dataDir": "~/.clawtoken"})
        client = ClawTokenClient(httpserver.url_for(""))
        config = client.node.get_config()
        assert config["dataDir"] == "~/.clawtoken"

    def test_wait_for_sync_already_synced(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/node/status").respond_with_json({
            "did": "did:claw:z6MkNode", "synced": True, "blockHeight": 100,
            "peers": 5, "network": "testnet", "version": "0.1.0", "uptime": 3600,
        })
        client = ClawTokenClient(httpserver.url_for(""))
        status = client.node.wait_for_sync(timeout=5.0)
        assert status["synced"] is True
