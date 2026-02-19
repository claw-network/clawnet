"""Shared test fixture — spinning up a mock HTTP server."""

from __future__ import annotations

import json
from typing import Any

import pytest
from pytest_httpserver import HTTPServer
from werkzeug import Request, Response


@pytest.fixture()
def mock_server(httpserver: HTTPServer) -> HTTPServer:
    """Return the pytest-httpserver instance."""
    return httpserver


def json_response(data: Any, status: int = 200) -> Response:
    """Build a Werkzeug JSON response."""
    return Response(
        json.dumps(data),
        status=status,
        content_type="application/json",
    )
