"""Top-level ClawToken client (sync + async)."""

from __future__ import annotations

from clawtoken.contracts import AsyncContractsApi, ContractsApi
from clawtoken.dao import AsyncDaoApi, DaoApi
from clawtoken.http import DEFAULT_BASE_URL, AsyncHttpClient, HttpClient
from clawtoken.identity import AsyncIdentityApi, IdentityApi
from clawtoken.markets import AsyncMarketsApi, MarketsApi
from clawtoken.node import AsyncNodeApi, NodeApi
from clawtoken.reputation import AsyncReputationApi, ReputationApi
from clawtoken.wallet import AsyncWalletApi, WalletApi


class ClawTokenClient:
    """Synchronous client for the ClawToken node HTTP API.

    Usage::

        client = ClawTokenClient()
        status = client.node.get_status()
        balance = client.wallet.get_balance()
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout: float = 30.0,
        api_key: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.http = HttpClient(base_url, timeout=timeout, api_key=api_key, headers=headers)
        self.node = NodeApi(self.http)
        self.identity = IdentityApi(self.http)
        self.wallet = WalletApi(self.http)
        self.reputation = ReputationApi(self.http)
        self.markets = MarketsApi(self.http)
        self.contracts = ContractsApi(self.http)
        self.dao = DaoApi(self.http)

    def close(self) -> None:
        self.http.close()

    def __enter__(self) -> "ClawTokenClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


class AsyncClawTokenClient:
    """Asynchronous client for the ClawToken node HTTP API.

    Usage::

        async with AsyncClawTokenClient() as client:
            status = await client.node.get_status()
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout: float = 30.0,
        api_key: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.http = AsyncHttpClient(base_url, timeout=timeout, api_key=api_key, headers=headers)
        self.node = AsyncNodeApi(self.http)
        self.identity = AsyncIdentityApi(self.http)
        self.wallet = AsyncWalletApi(self.http)
        self.reputation = AsyncReputationApi(self.http)
        self.markets = AsyncMarketsApi(self.http)
        self.contracts = AsyncContractsApi(self.http)
        self.dao = AsyncDaoApi(self.http)

    async def aclose(self) -> None:
        await self.http.aclose()

    async def __aenter__(self) -> "AsyncClawTokenClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()
