"""Type definitions (dataclasses) mirroring the ClawToken OpenAPI schema.

All types use ``TypedDict`` for maximum JSON compatibility — the SDK returns
raw dicts from the API, and these types provide editor auto-complete.
"""

from __future__ import annotations

from typing import Any, TypedDict


# ---------------------------------------------------------------------------
# Common
# ---------------------------------------------------------------------------

class Pagination(TypedDict, total=False):
    offset: int
    limit: int
    total: int


class EventFields(TypedDict, total=False):
    did: str
    passphrase: str
    nonce: int
    prev: str | None
    ts: int | None


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class NodeStatus(TypedDict):
    did: str
    synced: bool
    blockHeight: int
    peers: int
    network: str
    version: str
    uptime: int


class PeerInfo(TypedDict, total=False):
    peerId: str
    multiaddrs: list[str]
    latency: int | None
    connectedAt: int | None


class NodePeersResponse(TypedDict):
    peers: list[PeerInfo]
    total: int


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

class Identity(TypedDict, total=False):
    did: str
    publicKey: str
    created: int
    updated: int


class Capability(TypedDict, total=False):
    id: str | None
    type: str
    name: str
    description: str | None
    version: str | None


class CapabilityCredential(TypedDict, total=False):
    type: str
    name: str
    description: str | None
    version: str | None


class CapabilitiesResponse(TypedDict):
    capabilities: list[Capability]


# ---------------------------------------------------------------------------
# Wallet
# ---------------------------------------------------------------------------

class Balance(TypedDict):
    balance: int
    available: int
    pending: int
    locked: int


class TransferParams(EventFields, total=False):
    to: str
    amount: int
    fee: int | None
    memo: str | None


class TransferResult(TypedDict):
    txHash: str
    from_: str  # 'from' is reserved in Python
    to: str
    amount: int
    status: str
    timestamp: int


class Transaction(TypedDict, total=False):
    txHash: str
    from_: str
    to: str
    amount: int
    fee: int | None
    memo: str | None
    type: str
    status: str
    timestamp: int


class TransactionHistoryResponse(TypedDict):
    transactions: list[Transaction]
    total: int
    hasMore: bool


class Escrow(TypedDict, total=False):
    id: str
    depositor: str
    beneficiary: str
    amount: int
    funded: int
    released: int
    status: str
    releaseRules: list[dict[str, Any]]
    refundRules: list[dict[str, Any]] | None
    arbiter: str | None
    expiresAt: int | None
    createdAt: int


# ---------------------------------------------------------------------------
# Reputation
# ---------------------------------------------------------------------------

class ReputationDimensions(TypedDict, total=False):
    transaction: float | None
    delivery: float | None
    quality: float | None
    social: float | None
    behavior: float | None


class Reputation(TypedDict, total=False):
    did: str
    score: float
    level: str
    levelNumber: int
    dimensions: ReputationDimensions
    totalTransactions: int
    successRate: float
    averageRating: float
    badges: list[str]
    updatedAt: int | None


class Review(TypedDict, total=False):
    id: str
    contractId: str | None
    reviewer: str
    reviewee: str
    rating: int
    comment: str | None
    aspects: dict[str, int] | None
    createdAt: int


class ReviewsResponse(TypedDict):
    reviews: list[Review]
    total: int
    averageRating: float


# ---------------------------------------------------------------------------
# Markets — Common
# ---------------------------------------------------------------------------

class Pricing(TypedDict, total=False):
    model: str
    basePrice: int
    currency: str | None


class MarketListing(TypedDict, total=False):
    id: str
    type: str
    seller: str
    title: str
    description: str | None
    tags: list[str] | None
    pricing: Pricing | None
    status: str
    createdAt: int
    updatedAt: int | None


class SearchResult(TypedDict):
    listings: list[MarketListing]
    total: int


# ---------------------------------------------------------------------------
# Markets — Info
# ---------------------------------------------------------------------------

class InfoPublishResponse(TypedDict):
    listingId: str
    txHash: str


class InfoPurchaseResponse(TypedDict):
    orderId: str
    txHash: str


# ---------------------------------------------------------------------------
# Markets — Task
# ---------------------------------------------------------------------------

class TaskPublishResponse(TypedDict):
    listingId: str
    txHash: str


class TaskBidResponse(TypedDict):
    bidId: str
    txHash: str


# ---------------------------------------------------------------------------
# Markets — Capability
# ---------------------------------------------------------------------------

class CapabilityPublishResponse(TypedDict):
    listingId: str
    txHash: str


class CapabilityLeaseResponse(TypedDict):
    leaseId: str
    txHash: str


class CapabilityLeaseDetail(TypedDict, total=False):
    lease: dict[str, Any]
    usage: list[dict[str, Any]]
    stats: dict[str, Any]


class CapabilityInvokeResponse(TypedDict):
    leaseId: str
    txHash: str
    usage: dict[str, Any]


class CapabilityLeaseActionResponse(TypedDict):
    leaseId: str
    txHash: str
    action: str


# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------

class ContractTerms(TypedDict, total=False):
    title: str
    description: str | None
    deliverables: list[str] | None
    deadline: int | None


class PaymentTerms(TypedDict, total=False):
    type: str
    totalAmount: int
    currency: str | None
    escrowRequired: bool | None


class ContractMilestone(TypedDict, total=False):
    id: str
    title: str
    description: str | None
    amount: int | None
    percentage: int | None
    deadline: int | None
    status: str
    deliverables: list[str] | None


class Contract(TypedDict, total=False):
    id: str
    client: str
    provider: str
    status: str
    terms: ContractTerms
    payment: PaymentTerms
    milestones: list[ContractMilestone]
    escrowId: str | None
    signatures: list[dict[str, Any]]
    createdAt: int


class CreateContractResponse(TypedDict):
    contractId: str
    txHash: str


class TxHashResponse(TypedDict):
    txHash: str


class ContractsListResponse(TypedDict):
    contracts: list[Contract]
    total: int


# ---------------------------------------------------------------------------
# Market Dispute
# ---------------------------------------------------------------------------

class MarketDisputeResponse(TypedDict):
    txHash: str
