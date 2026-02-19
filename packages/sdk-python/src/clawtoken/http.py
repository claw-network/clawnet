"""Low-level HTTP client for the ClawToken node API (sync + async)."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from clawtoken.exceptions import ClawTokenError

DEFAULT_BASE_URL = "http://127.0.0.1:9528"
DEFAULT_TIMEOUT = 30.0


def _build_url(base: str, path: str, params: dict[str, Any] | None = None) -> str:
    url = base.rstrip("/") + path
    if params:
        filtered = {k: v for k, v in params.items() if v is not None}
        if filtered:
            url += "?" + urlencode(filtered, doseq=True)
    return url


def _handle_error(resp: httpx.Response) -> None:
    if resp.is_success:
        return
    try:
        body = resp.json()
        msg = body.get("error", {}).get("message", resp.text) if isinstance(body, dict) else resp.text
        code = body.get("error", {}).get("code") if isinstance(body, dict) else None
    except Exception:
        msg = resp.text
        code = None
    raise ClawTokenError(msg, status=resp.status_code, code=code)


# ---------------------------------------------------------------------------
# Synchronous client
# ---------------------------------------------------------------------------

class HttpClient:
    """Synchronous HTTP client wrapping ``httpx.Client``."""

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        api_key: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        _headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            _headers["Authorization"] = f"Bearer {api_key}"
        if headers:
            _headers.update(headers)
        self._client = httpx.Client(timeout=timeout, headers=_headers)

    # -- HTTP verbs ----------------------------------------------------------

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = _build_url(self.base_url, path, params)
        resp = self._client.get(url)
        _handle_error(resp)
        return resp.json()

    def post(self, path: str, body: dict[str, Any] | None = None) -> Any:
        url = _build_url(self.base_url, path)
        resp = self._client.post(url, json=body)
        _handle_error(resp)
        return resp.json()

    def put(self, path: str, body: dict[str, Any] | None = None) -> Any:
        url = _build_url(self.base_url, path)
        resp = self._client.put(url, json=body)
        _handle_error(resp)
        return resp.json()

    def delete(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = _build_url(self.base_url, path, params)
        resp = self._client.delete(url)
        _handle_error(resp)
        return resp.json()

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "HttpClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Asynchronous client
# ---------------------------------------------------------------------------

class AsyncHttpClient:
    """Asynchronous HTTP client wrapping ``httpx.AsyncClient``."""

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        api_key: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        _headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            _headers["Authorization"] = f"Bearer {api_key}"
        if headers:
            _headers.update(headers)
        self._client = httpx.AsyncClient(timeout=timeout, headers=_headers)

    # -- HTTP verbs ----------------------------------------------------------

    async def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = _build_url(self.base_url, path, params)
        resp = await self._client.get(url)
        _handle_error(resp)
        return resp.json()

    async def post(self, path: str, body: dict[str, Any] | None = None) -> Any:
        url = _build_url(self.base_url, path)
        resp = await self._client.post(url, json=body)
        _handle_error(resp)
        return resp.json()

    async def put(self, path: str, body: dict[str, Any] | None = None) -> Any:
        url = _build_url(self.base_url, path)
        resp = await self._client.put(url, json=body)
        _handle_error(resp)
        return resp.json()

    async def delete(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = _build_url(self.base_url, path, params)
        resp = await self._client.delete(url)
        _handle_error(resp)
        return resp.json()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AsyncHttpClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.aclose()
