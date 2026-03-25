import type {
  BidTaskInput,
  DeliverInput,
  LeaseCapabilityInput,
  OpenDisputeInput,
  PublishCapabilityInput,
  PublishInfoInput,
  PublishTaskInput,
  RespondDisputeInput,
  ResolveDisputeInput,
  ReviewInput,
} from "@/lib/telagent-client"
import { create } from "zustand"

import { useConnectionStore } from "@/stores/connection"

export type ListingType = "info" | "task" | "capability"

export interface UnifiedListingView {
  id: string
  type: ListingType
  title: string
  description?: string
  price?: number
  status: string
  owner?: string
  tags?: string[]
  deadlineMs?: number
  raw: unknown
}

export interface MarketBidView {
  id: string
  bidder?: string
  amount?: number
  status: string
  proposal?: string
  createdAtMs?: number
  raw: unknown
}

export interface DisputeView {
  id: string
  orderId: string
  status: string
  reason: string
  evidence?: string
  raw: unknown
}

interface MarketStore {
  listings: UnifiedListingView[]
  searchResults: UnifiedListingView[]
  activeFilter: ListingType | "all"
  bidsByTask: Record<string, MarketBidView[]>
  disputes: DisputeView[]
  loadingListings: boolean
  loadingBids: boolean
  loadingDisputes: boolean
  error?: string

  setActiveFilter: (filter: ListingType | "all") => void
  refreshListings: (filter?: ListingType | "all") => Promise<void>
  searchMarkets: (q: string, type?: string) => Promise<void>

  loadBids: (taskId: string) => Promise<void>
  publishTask: (sessionToken: string, input: PublishTaskInput) => Promise<unknown>
  bid: (sessionToken: string, taskId: string, input: BidTaskInput) => Promise<unknown>
  acceptBid: (sessionToken: string, taskId: string, bidId: string) => Promise<unknown>
  rejectBid: (sessionToken: string, taskId: string, bidId: string) => Promise<unknown>
  withdrawBid: (sessionToken: string, taskId: string, bidId: string) => Promise<unknown>
  deliverTask: (sessionToken: string, taskId: string, input: DeliverInput) => Promise<unknown>
  confirmTask: (sessionToken: string, taskId: string) => Promise<unknown>

  publishInfo: (sessionToken: string, input: PublishInfoInput) => Promise<unknown>
  purchaseInfo: (sessionToken: string, id: string) => Promise<unknown>
  deliverInfo: (sessionToken: string, id: string, input: DeliverInput) => Promise<unknown>
  confirmInfo: (sessionToken: string, id: string) => Promise<unknown>
  subscribeInfo: (sessionToken: string, id: string) => Promise<unknown>
  unsubscribeInfo: (sessionToken: string, id: string) => Promise<unknown>

  publishCapability: (sessionToken: string, input: PublishCapabilityInput) => Promise<unknown>
  leaseCapability: (sessionToken: string, id: string, input?: LeaseCapabilityInput) => Promise<unknown>
  invokeCapability: (sessionToken: string, leaseId: string, payload: Record<string, unknown>) => Promise<unknown>
  pauseLease: (sessionToken: string, leaseId: string) => Promise<unknown>
  resumeLease: (sessionToken: string, leaseId: string) => Promise<unknown>
  terminateLease: (sessionToken: string, leaseId: string) => Promise<unknown>

  submitReview: (sessionToken: string, input: ReviewInput) => Promise<unknown>
  createServiceContract: (sessionToken: string, payload: Record<string, unknown>) => Promise<unknown>

  openDispute: (sessionToken: string, input: OpenDisputeInput) => Promise<unknown>
  respondDispute: (sessionToken: string, disputeId: string, input: RespondDisputeInput) => Promise<unknown>
  resolveDispute: (sessionToken: string, disputeId: string, input: ResolveDisputeInput) => Promise<unknown>
  refreshDisputes: () => Promise<void>

  getListingById: (id: string) => UnifiedListingView | null
  clear: () => void
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }
  return undefined
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric
    }
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function parseTask(raw: unknown, index: number): UnifiedListingView {
  const source = asRecord(raw)
  return {
    id: pickString(source, ["id", "taskId", "listingId"]) ?? `task-${index}`,
    type: "task",
    title: pickString(source, ["title", "name"]) ?? `Task ${index + 1}`,
    description: pickString(source, ["description", "summary", "content"]),
    price: pickNumber(source, ["budget", "amount", "price"]),
    status: pickString(source, ["status", "state"]) ?? "unknown",
    owner: pickString(source, ["owner", "publisher", "creator", "did"]),
    tags: Array.isArray(source.tags) ? source.tags.filter((item): item is string => typeof item === "string") : undefined,
    deadlineMs:
      parseTimestamp(source.deadlineMs)
      ?? parseTimestamp(source.deadline)
      ?? parseTimestamp(source.dueAt),
    raw,
  }
}

function parseInfoListing(raw: unknown, index: number): UnifiedListingView {
  const source = asRecord(raw)
  return {
    id: pickString(source, ["id", "listingId"]) ?? `info-${index}`,
    type: "info",
    title: pickString(source, ["title", "name"]) ?? `Info ${index + 1}`,
    description: pickString(source, ["description", "summary", "content"]),
    price: pickNumber(source, ["price", "amount"]),
    status: pickString(source, ["status", "state"]) ?? "unknown",
    owner: pickString(source, ["owner", "publisher", "creator", "did"]),
    tags: Array.isArray(source.tags) ? source.tags.filter((item): item is string => typeof item === "string") : undefined,
    raw,
  }
}

function parseCapability(raw: unknown, index: number): UnifiedListingView {
  const source = asRecord(raw)
  return {
    id: pickString(source, ["id", "capabilityId", "listingId"]) ?? `cap-${index}`,
    type: "capability",
    title: pickString(source, ["title", "name"]) ?? `Capability ${index + 1}`,
    description: pickString(source, ["description", "summary"]),
    price: pickNumber(source, ["pricePerInvocation", "price", "amount"]),
    status: pickString(source, ["status", "state"]) ?? "unknown",
    owner: pickString(source, ["owner", "publisher", "creator", "did"]),
    tags: Array.isArray(source.tags) ? source.tags.filter((item): item is string => typeof item === "string") : undefined,
    raw,
  }
}

function parseSearchResult(raw: unknown, index: number): UnifiedListingView {
  const source = asRecord(raw)
  const rawType = pickString(source, ["type", "marketType", "listingType"]) ?? ""
  let type: ListingType = "task"
  if (rawType.includes("info")) type = "info"
  else if (rawType.includes("capabilit")) type = "capability"
  return {
    id: pickString(source, ["id", "taskId", "listingId", "capabilityId"]) ?? `result-${index}`,
    type,
    title: pickString(source, ["title", "name"]) ?? `Listing ${index + 1}`,
    description: pickString(source, ["description", "summary", "content"]),
    price: pickNumber(source, ["price", "budget", "amount", "pricePerInvocation"]),
    status: pickString(source, ["status", "state"]) ?? "unknown",
    owner: pickString(source, ["owner", "publisher", "creator", "did"]),
    tags: Array.isArray(source.tags) ? source.tags.filter((item): item is string => typeof item === "string") : undefined,
    deadlineMs: parseTimestamp(source.deadlineMs) ?? parseTimestamp(source.deadline),
    raw,
  }
}

function parseDispute(raw: unknown, index: number): DisputeView {
  const source = asRecord(raw)
  return {
    id: pickString(source, ["id", "disputeId"]) ?? `dispute-${index}`,
    orderId: pickString(source, ["orderId", "orderid"]) ?? "",
    status: pickString(source, ["status", "state"]) ?? "unknown",
    reason: pickString(source, ["reason", "description"]) ?? "",
    evidence: pickString(source, ["evidence"]),
    raw,
  }
}

function parseBid(raw: unknown, index: number): MarketBidView {
  const source = asRecord(raw)
  return {
    id: pickString(source, ["id", "bidId"]) ?? `bid-${index}`,
    bidder: pickString(source, ["bidder", "did", "owner"]),
    amount: pickNumber(source, ["amount", "price", "value"]),
    status: pickString(source, ["status", "state"]) ?? "unknown",
    proposal: pickString(source, ["proposal", "message", "description"]),
    createdAtMs:
      parseTimestamp(source.createdAtMs)
      ?? parseTimestamp(source.createdAt)
      ?? parseTimestamp(source.updatedAt),
    raw,
  }
}

function sortListings(items: UnifiedListingView[]): UnifiedListingView[] {
  return [...items].sort((left, right) => {
    const rightScore = right.deadlineMs ?? right.price ?? 0
    const leftScore = left.deadlineMs ?? left.price ?? 0
    return rightScore - leftScore
  })
}

function getSdk() {
  const sdk = useConnectionStore.getState().sdk
  if (!sdk) throw new Error("SDK not connected")
  return sdk
}

export const useMarketStore = create<MarketStore>((set, get) => ({
  listings: [],
  searchResults: [],
  activeFilter: "all",
  bidsByTask: {},
  disputes: [],
  loadingListings: false,
  loadingBids: false,
  loadingDisputes: false,
  error: undefined,

  setActiveFilter: (filter) => {
    set({ activeFilter: filter })
    void get().refreshListings(filter)
  },

  refreshListings: async (filter) => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) return

    const actualFilter = filter ?? get().activeFilter
    set({ loadingListings: true, error: undefined })
    try {
      const batches: UnifiedListingView[] = []
      const fetchers: Promise<void>[] = []
      if (actualFilter === "all" || actualFilter === "task") {
        fetchers.push(
          sdk.marketplace.listTasks()
            .then((raw) => { batches.push(...raw.map((t, i) => parseTask(t, i))) })
            .catch(() => {}),
        )
      }
      if (actualFilter === "all" || actualFilter === "info") {
        fetchers.push(
          sdk.marketplace.listInfoListings()
            .then((raw) => { batches.push(...raw.map((t, i) => parseInfoListing(t, i))) })
            .catch(() => {}),
        )
      }
      if (actualFilter === "all" || actualFilter === "capability") {
        fetchers.push(
          sdk.marketplace.listCapabilities()
            .then((raw) => { batches.push(...raw.map((t, i) => parseCapability(t, i))) })
            .catch(() => {}),
        )
      }
      await Promise.all(fetchers)
      set({ listings: sortListings(batches), loadingListings: false })
    } catch (error) {
      set({
        loadingListings: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  searchMarkets: async (q, type) => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) return

    set({ loadingListings: true, error: undefined })
    try {
      const rawResults = await sdk.marketplace.search({ q, type })
      const searchResults = sortListings(rawResults.map((r, i) => parseSearchResult(r, i)))
      set({ searchResults, loadingListings: false })
    } catch (error) {
      set({
        loadingListings: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  loadBids: async (taskId) => {
    const normalizedTaskId = taskId.trim()
    if (!normalizedTaskId) return
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) return

    set({ loadingBids: true, error: undefined })
    try {
      const rawBids = await sdk.marketplace.listTaskBids(normalizedTaskId)
      const bids = rawBids.map((bid, index) => parseBid(bid, index))
      set((state) => ({
        bidsByTask: { ...state.bidsByTask, [normalizedTaskId]: bids },
        loadingBids: false,
      }))
    } catch (error) {
      set({ loadingBids: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  // ── Task actions ────────────────────────────────────────────────────────

  publishTask: async (sessionToken, input) => {
    const result = await getSdk().marketplace.publishTask(sessionToken, input)
    await get().refreshListings()
    return result
  },
  bid: async (sessionToken, taskId, input) => {
    const result = await getSdk().marketplace.bid(sessionToken, taskId, input)
    await get().loadBids(taskId)
    return result
  },
  acceptBid: async (sessionToken, taskId, bidId) => {
    const result = await getSdk().marketplace.acceptBid(sessionToken, taskId, bidId)
    await Promise.all([get().refreshListings(), get().loadBids(taskId)])
    return result
  },
  rejectBid: async (sessionToken, taskId, bidId) => {
    const result = await getSdk().marketplace.rejectBid(sessionToken, taskId, bidId)
    await get().loadBids(taskId)
    return result
  },
  withdrawBid: async (sessionToken, taskId, bidId) => {
    const result = await getSdk().marketplace.withdrawBid(sessionToken, taskId, bidId)
    await get().loadBids(taskId)
    return result
  },
  deliverTask: async (sessionToken, taskId, input) => {
    const result = await getSdk().marketplace.deliverTask(sessionToken, taskId, input)
    await get().refreshListings()
    return result
  },
  confirmTask: async (sessionToken, taskId) => {
    const result = await getSdk().marketplace.confirmTask(sessionToken, taskId)
    await get().refreshListings()
    return result
  },

  // ── Info actions ────────────────────────────────────────────────────────

  publishInfo: async (sessionToken, input) => {
    const result = await getSdk().marketplace.publishInfo(sessionToken, input)
    await get().refreshListings()
    return result
  },
  purchaseInfo: async (sessionToken, id) => {
    const result = await getSdk().marketplace.purchaseInfo(sessionToken, id)
    await get().refreshListings()
    return result
  },
  deliverInfo: async (sessionToken, id, input) => {
    const result = await getSdk().marketplace.deliverInfo(sessionToken, id, input)
    await get().refreshListings()
    return result
  },
  confirmInfo: async (sessionToken, id) => {
    const result = await getSdk().marketplace.confirmInfo(sessionToken, id)
    await get().refreshListings()
    return result
  },
  subscribeInfo: async (sessionToken, id) => {
    return getSdk().marketplace.subscribeInfo(sessionToken, id)
  },
  unsubscribeInfo: async (sessionToken, id) => {
    return getSdk().marketplace.unsubscribeInfo(sessionToken, id)
  },

  // ── Capability actions ──────────────────────────────────────────────────

  publishCapability: async (sessionToken, input) => {
    const result = await getSdk().marketplace.publishCapability(sessionToken, input)
    await get().refreshListings()
    return result
  },
  leaseCapability: async (sessionToken, id, input) => {
    return getSdk().marketplace.leaseCapability(sessionToken, id, input)
  },
  invokeCapability: async (sessionToken, leaseId, payload) => {
    return getSdk().marketplace.invokeCapability(sessionToken, leaseId, { payload })
  },
  pauseLease: async (sessionToken, leaseId) => {
    return getSdk().marketplace.pauseLease(sessionToken, leaseId)
  },
  resumeLease: async (sessionToken, leaseId) => {
    return getSdk().marketplace.resumeLease(sessionToken, leaseId)
  },
  terminateLease: async (sessionToken, leaseId) => {
    return getSdk().marketplace.terminateLease(sessionToken, leaseId)
  },

  // ── Common ──────────────────────────────────────────────────────────────

  submitReview: async (sessionToken, input) => {
    return getSdk().marketplace.submitReview(sessionToken, input)
  },
  createServiceContract: async (sessionToken, payload) => {
    return getSdk().marketplace.createServiceContract(sessionToken, payload)
  },

  // ── Disputes ────────────────────────────────────────────────────────────

  openDispute: async (sessionToken, input) => {
    const result = await getSdk().marketplace.openDispute(sessionToken, input)
    await get().refreshDisputes()
    return result
  },
  respondDispute: async (sessionToken, disputeId, input) => {
    const result = await getSdk().marketplace.respondDispute(sessionToken, disputeId, input)
    await get().refreshDisputes()
    return result
  },
  resolveDispute: async (sessionToken, disputeId, input) => {
    const result = await getSdk().marketplace.resolveDispute(sessionToken, disputeId, input)
    await get().refreshDisputes()
    return result
  },
  refreshDisputes: async () => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) return

    set({ loadingDisputes: true })
    try {
      const rawDisputes = await sdk.marketplace.listDisputes()
      const disputes = rawDisputes.map((d, i) => parseDispute(d, i))
      set({ disputes, loadingDisputes: false })
    } catch (error) {
      set({ loadingDisputes: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  getListingById: (id) => {
    const normalizedId = id.trim()
    if (!normalizedId) return null
    const state = get()
    return state.listings.find((l) => l.id === normalizedId)
      ?? state.searchResults.find((l) => l.id === normalizedId)
      ?? null
  },

  clear: () => {
    set({
      listings: [],
      searchResults: [],
      activeFilter: "all",
      bidsByTask: {},
      disputes: [],
      loadingListings: false,
      loadingBids: false,
      loadingDisputes: false,
      error: undefined,
    })
  },
}))
