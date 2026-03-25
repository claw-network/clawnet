import type { CreateEscrowInput, TransferInput } from "@/lib/telagent-client"
import { create } from "zustand"

import { useConnectionStore } from "@/stores/connection"

export interface WalletBalanceView {
  did: string
  native: string
  token: string
  address?: string
}

export interface WalletNonceView {
  nonce: number
  address?: string
}

export interface WalletHistoryItem {
  id: string
  type: string
  amount?: number
  status?: string
  txHash?: string
  from?: string
  to?: string
  timestampMs?: number
  escrowId?: string
  raw: unknown
}

export interface WalletEscrowView {
  id: string
  creator?: string
  beneficiary?: string
  amount?: number
  status: string
  releaseRules?: unknown[]
  updatedAtMs?: number
  raw: unknown
}

interface WalletStore {
  balance: WalletBalanceView | null
  nonce: WalletNonceView | null
  history: WalletHistoryItem[]
  escrows: WalletEscrowView[]
  loading: boolean
  loadingEscrows: boolean
  error?: string
  historyLimit: number
  historyOffset: number
  refreshAll: () => Promise<void>
  refreshBalance: () => Promise<void>
  refreshNonce: () => Promise<void>
  refreshHistory: (limit?: number, offset?: number) => Promise<void>
  refreshEscrows: () => Promise<void>
  loadEscrow: (escrowId: string) => Promise<WalletEscrowView | null>
  transfer: (sessionToken: string, input: TransferInput) => Promise<unknown>
  createEscrow: (sessionToken: string, input: CreateEscrowInput) => Promise<WalletEscrowView | null>
  releaseEscrow: (sessionToken: string, escrowId: string) => Promise<unknown>
  claimFaucet: (sessionToken: string) => Promise<{ amount: number; txHash: string | null }>
  setHistoryPage: (page: number) => Promise<void>
  upsertEscrow: (escrow: WalletEscrowView) => void
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
    // Values < 1e11 are seconds-based Unix timestamps (year < 5138); convert to ms
    return value < 1e11 ? value * 1000 : value
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric < 1e11 ? numeric * 1000 : numeric
    }
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function parseBalance(raw: unknown): WalletBalanceView {
  const source = asRecord(raw)
  return {
    did: pickString(source, ["did"]) ?? "",
    native: pickString(source, ["native", "nativeBalance", "balance"]) ?? "0",
    token: pickString(source, ["token", "tokenBalance"]) ?? "0",
    address: pickString(source, ["address", "walletAddress"]),
  }
}

function parseNonce(raw: unknown): WalletNonceView {
  const source = asRecord(raw)
  return {
    nonce: pickNumber(source, ["nonce"]) ?? 0,
    address: pickString(source, ["address", "walletAddress"]),
  }
}

function parseHistoryItem(raw: unknown, index: number): WalletHistoryItem {
  const source = asRecord(raw)
  const txHash = pickString(source, ["txHash", "hash", "transactionHash"])
  const id = pickString(source, ["id", "eventId", "logId", "escrowId"]) ?? txHash ?? `history-${index}`
  const type = pickString(source, ["type", "action", "kind"]) ?? "unknown"
  const escrowId = pickString(source, ["escrowId", "escrow", "escrow_id"]) ?? (type.includes("escrow") ? id : undefined)

  return {
    id,
    type,
    amount: pickNumber(source, ["amount", "value"]),
    status: pickString(source, ["status", "state"]),
    txHash,
    from: pickString(source, ["from", "fromDid", "sender"]),
    to: pickString(source, ["to", "toDid", "recipient", "beneficiary"]),
    timestampMs:
      parseTimestamp(source.timestampMs)
      ?? parseTimestamp(source.timestamp)
      ?? parseTimestamp(source.createdAt)
      ?? parseTimestamp(source.updatedAt),
    escrowId,
    raw,
  }
}

function parseEscrow(raw: unknown): WalletEscrowView | null {
  const source = asRecord(raw)
  const id = pickString(source, ["id", "escrowId", "escrow_id"])
  if (!id) {
    return null
  }

  return {
    id,
    creator: pickString(source, ["creator", "owner", "from"]),
    beneficiary: pickString(source, ["beneficiary", "to"]),
    amount: pickNumber(source, ["amount", "value"]),
    status: pickString(source, ["status", "state"]) ?? "unknown",
    releaseRules: Array.isArray(source.releaseRules) ? source.releaseRules : undefined,
    updatedAtMs:
      parseTimestamp(source.updatedAtMs)
      ?? parseTimestamp(source.updatedAt)
      ?? parseTimestamp(source.createdAt),
    raw,
  }
}

function mergeEscrows(current: WalletEscrowView[], next: WalletEscrowView): WalletEscrowView[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  byId.set(next.id, next)
  return [...byId.values()].sort((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0))
}

export const useWalletStore = create<WalletStore>((set, get) => ({
  balance: null,
  nonce: null,
  history: [],
  escrows: [],
  loading: false,
  loadingEscrows: false,
  error: undefined,
  historyLimit: 20,
  historyOffset: 0,
  refreshAll: async () => {
    set({ loading: true, error: undefined })
    try {
      await Promise.all([
        get().refreshBalance(),
        get().refreshNonce(),
        get().refreshHistory(get().historyLimit, get().historyOffset),
      ])
      await get().refreshEscrows()
      set({ loading: false, error: undefined })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
  refreshBalance: async () => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      return
    }

    const balanceRaw = await sdk.wallet.getBalance()
    set({ balance: parseBalance(balanceRaw) })
  },
  refreshNonce: async () => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      return
    }

    const nonceRaw = await sdk.wallet.getNonce()
    set({ nonce: parseNonce(nonceRaw) })
  },
  refreshHistory: async (limit, offset) => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      return
    }

    const nextLimit = typeof limit === "number" && limit > 0 ? limit : get().historyLimit
    const nextOffset = typeof offset === "number" && offset >= 0 ? offset : get().historyOffset
    const raw = await sdk.wallet.getHistory({ limit: nextLimit, offset: nextOffset })
    const rawItems = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.items) ? (raw as any).items : []
    const history = rawItems.map((item: unknown, index: number) => parseHistoryItem(item, index))

    set({
      history,
      historyLimit: nextLimit,
      historyOffset: nextOffset,
    })
  },
  refreshEscrows: async () => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      return
    }

    const ids = new Set<string>()
    for (const item of get().history) {
      if (item.escrowId) {
        ids.add(item.escrowId)
      }
    }

    if (ids.size === 0) {
      return
    }

    set({ loadingEscrows: true })
    try {
      const updates = await Promise.all(
        [...ids].map(async (escrowId) => {
          const raw = await sdk.clawnet.getEscrow(escrowId)
          return parseEscrow(raw)
        }),
      )

      set((state) => {
        let escrows = state.escrows
        for (const nextEscrow of updates) {
          if (!nextEscrow) {
            continue
          }
          escrows = mergeEscrows(escrows, nextEscrow)
        }
        return {
          escrows,
          loadingEscrows: false,
        }
      })
    } catch (error) {
      set({
        loadingEscrows: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
  loadEscrow: async (escrowId) => {
    const normalizedEscrowId = escrowId.trim()
    if (!normalizedEscrowId) {
      return null
    }

    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      return null
    }

    const raw = await sdk.clawnet.getEscrow(normalizedEscrowId)
    const escrow = parseEscrow(raw)
    if (!escrow) {
      return null
    }

    set((state) => ({
      escrows: mergeEscrows(state.escrows, escrow),
    }))
    return escrow
  },
  transfer: async (sessionToken, input) => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      throw new Error("SDK not connected")
    }

    const result = await sdk.wallet.transfer(sessionToken, input)
    await Promise.all([get().refreshBalance(), get().refreshHistory()])
    return result
  },
  createEscrow: async (sessionToken, input) => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      throw new Error("SDK not connected")
    }

    const result = await sdk.wallet.createEscrow(sessionToken, input)
    const escrow = parseEscrow(result)
    if (escrow) {
      set((state) => ({
        escrows: mergeEscrows(state.escrows, escrow),
      }))
    }

    await Promise.all([get().refreshBalance(), get().refreshHistory()])
    if (escrow?.id) {
      await get().loadEscrow(escrow.id)
    }

    return escrow
  },
  releaseEscrow: async (sessionToken, escrowId) => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      throw new Error("SDK not connected")
    }

    const result = await sdk.wallet.releaseEscrow(sessionToken, escrowId)
    await Promise.all([get().refreshBalance(), get().refreshHistory(), get().loadEscrow(escrowId)])
    return result
  },
  claimFaucet: async (sessionToken) => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      throw new Error("SDK not connected")
    }

    const result = await sdk.faucet.claim(sessionToken)
    await get().refreshBalance()
    return { amount: result.amount, txHash: result.txHash }
  },
  setHistoryPage: async (page) => {
    const targetPage = page < 1 ? 1 : page
    const offset = (targetPage - 1) * get().historyLimit
    await get().refreshHistory(get().historyLimit, offset)
  },
  upsertEscrow: (escrow) => {
    set((state) => ({
      escrows: mergeEscrows(state.escrows, escrow),
    }))
  },
  clear: () => {
    set({
      balance: null,
      nonce: null,
      history: [],
      escrows: [],
      loading: false,
      loadingEscrows: false,
      error: undefined,
      historyLimit: 20,
      historyOffset: 0,
    })
  },
}))
