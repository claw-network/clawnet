"""Tests for the low-level HTTP client."""

import json

from pytest_httpserver import HTTPServer

from clawtoken.exceptions import ClawTokenError
from clawtoken.http import HttpClient
from tests.conftest import json_response
import pytest


class TestHttpClient:
    def test_get_json(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/test").respond_with_json({"ok": True})
        client = HttpClient(httpserver.url_for(""))
        result = client.get("/api/test")
        assert result == {"ok": True}

    def test_post_json(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/test", method="POST").respond_with_json({"created": True}, status=201)
        client = HttpClient(httpserver.url_for(""))
        result = client.post("/api/test", {"key": "value"})
        assert result == {"created": True}

    def test_put_json(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/test", method="PUT").respond_with_json({"updated": True})
        client = HttpClient(httpserver.url_for(""))
        result = client.put("/api/test", {"key": "value"})
        assert result == {"updated": True}

    def test_delete_json(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/test", method="DELETE").respond_with_json({"deleted": True})
        client = HttpClient(httpserver.url_for(""))
        result = client.delete("/api/test")
        assert result == {"deleted": True}

    def test_query_params(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/test", query_string="limit=5&offset=10").respond_with_json({"items": []})
        client = HttpClient(httpserver.url_for(""))
        result = client.get("/api/test", {"limit": 5, "offset": 10})
        assert result == {"items": []}

    def test_error_response(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/fail").respond_with_json(
            {"error": {"code": "NOT_FOUND", "message": "Resource not found"}},
            status=404,
        )
        client = HttpClient(httpserver.url_for(""))
        with pytest.raises(ClawTokenError) as exc_info:
            client.get("/api/fail")
        assert exc_info.value.status == 404
        assert exc_info.value.code == "NOT_FOUND"

    def test_api_key_header(self, httpserver: HTTPServer) -> None:
        def check_auth(request):
            auth = request.headers.get("Authorization", "")
            assert auth == "Bearer my-secret-key"
            return json_response({"authenticated": True})

        httpserver.expect_request("/api/secure").respond_with_handler(check_auth)
        client = HttpClient(httpserver.url_for(""), api_key="my-secret-key")
        result = client.get("/api/secure")
        assert result == {"authenticated": True}

    def test_context_manager(self, httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/test").respond_with_json({"ok": True})
        with HttpClient(httpserver.url_for("")) as client:
            result = client.get("/api/test")
        assert result == {"ok": True}
