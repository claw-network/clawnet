import type { SessionOperationScope, UnlockSessionInput } from "@/lib/telagent-client"
import { create } from "zustand"

import { useConnectionStore } from "@/stores/connection"

export type SessionStatus = "locked" | "unlocking" | "unlocked"

interface SessionStore {
  token: string | null
  expiresAt: string | null
  scope: SessionOperationScope[]
  status: SessionStatus
  error?: string
  unlockDialogOpen: boolean
  requestedScope: SessionOperationScope[]
  requestUnlock: (requiredScope?: SessionOperationScope[]) => Promise<string>
  openUnlockDialog: (requiredScope?: SessionOperationScope[]) => void
  cancelUnlockRequest: () => void
  unlock: (input: UnlockSessionInput) => Promise<void>
  lock: () => Promise<void>
  refresh: () => Promise<void>
  clearIfExpired: () => void
  clear: () => void
  hasValidSession: (requiredScope?: SessionOperationScope[]) => boolean
  getRemainingMs: () => number
}

let pendingUnlockPromise: Promise<string> | null = null
let resolvePendingUnlock: ((token: string) => void) | null = null
let rejectPendingUnlock: ((error: Error) => void) | null = null

function normalizeScope(scope?: SessionOperationScope[]): SessionOperationScope[] {
  if (!scope || scope.length === 0) {
    return []
  }
  return Array.from(new Set(scope))
}

function parseExpiresAtMs(expiresAt: string | null): number {
  if (!expiresAt) {
    return 0
  }
  const parsed = Date.parse(expiresAt)
  return Number.isFinite(parsed) ? parsed : 0
}

function clearPendingUnlock(error?: Error): void {
  if (error && rejectPendingUnlock) {
    rejectPendingUnlock(error)
  }
  pendingUnlockPromise = null
  resolvePendingUnlock = null
  rejectPendingUnlock = null
}

function createPendingUnlock(): Promise<string> {
  if (pendingUnlockPromise) {
    return pendingUnlockPromise
  }
  pendingUnlockPromise = new Promise<string>((resolve, reject) => {
    resolvePendingUnlock = resolve
    rejectPendingUnlock = reject
  })
  return pendingUnlockPromise
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  token: null,
  expiresAt: null,
  scope: [],
  status: "locked",
  error: undefined,
  unlockDialogOpen: false,
  requestedScope: [],
  requestUnlock: async (requiredScope) => {
    get().clearIfExpired()

    if (get().hasValidSession(requiredScope) && get().token) {
      return get().token as string
    }

    set({
      unlockDialogOpen: true,
      requestedScope: normalizeScope(requiredScope),
      error: undefined,
    })

    return createPendingUnlock()
  },
  openUnlockDialog: (requiredScope) => {
    set({
      unlockDialogOpen: true,
      requestedScope: normalizeScope(requiredScope),
      error: undefined,
    })
  },
  cancelUnlockRequest: () => {
    set({
      unlockDialogOpen: false,
      status: get().token ? "unlocked" : "locked",
      requestedScope: [],
    })
    if (pendingUnlockPromise) {
      clearPendingUnlock(new Error("Session unlock cancelled"))
    }
  },
  unlock: async (input) => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      const error = new Error("SDK not connected")
      set({ status: "locked", error: error.message })
      throw error
    }

    set({ status: "unlocking", error: undefined })
    try {
      const unlocked = await sdk.session.unlock(input)
      set({
        token: unlocked.sessionToken,
        expiresAt: unlocked.expiresAt,
        scope: unlocked.scope as SessionOperationScope[],
        status: "unlocked",
        error: undefined,
        unlockDialogOpen: false,
        requestedScope: [],
      })
      if (resolvePendingUnlock) {
        resolvePendingUnlock(unlocked.sessionToken)
      }
      clearPendingUnlock()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({
        status: get().token ? "unlocked" : "locked",
        error: message,
      })
      throw error
    }
  },
  lock: async () => {
    const sdk = useConnectionStore.getState().sdk
    const token = get().token

    if (sdk && token) {
      try {
        await sdk.session.lock(token)
      } catch {
        // best effort, local state still needs to be wiped
      }
    }

    clearPendingUnlock(new Error("Session locked"))
    set({
      token: null,
      expiresAt: null,
      scope: [],
      status: "locked",
      error: undefined,
      unlockDialogOpen: false,
      requestedScope: [],
    })
  },
  refresh: async () => {
    const sdk = useConnectionStore.getState().sdk
    const token = get().token
    if (!sdk || !token) {
      return
    }

    try {
      const info = await sdk.session.getInfo(token)
      if (!info.active) {
        await get().lock()
        return
      }
      set({
        expiresAt: info.expiresAt,
        scope: info.scope as SessionOperationScope[],
        status: "unlocked",
        error: undefined,
      })
      get().clearIfExpired()
    } catch {
      await get().lock()
    }
  },
  clearIfExpired: () => {
    const { token, expiresAt } = get()
    if (!token) {
      return
    }

    const expiresAtMs = parseExpiresAtMs(expiresAt)
    if (!expiresAtMs) {
      return
    }
    if (Date.now() >= expiresAtMs) {
      clearPendingUnlock(new Error("Session expired"))
      set({
        token: null,
        expiresAt: null,
        scope: [],
        status: "locked",
        error: undefined,
      })
    }
  },
  clear: () => {
    clearPendingUnlock(new Error("Session cleared"))
    set({
      token: null,
      expiresAt: null,
      scope: [],
      status: "locked",
      error: undefined,
      unlockDialogOpen: false,
      requestedScope: [],
    })
  },
  hasValidSession: (requiredScope) => {
    const state = get()
    if (!state.token || state.status !== "unlocked") {
      return false
    }

    const expiresAtMs = parseExpiresAtMs(state.expiresAt)
    if (!expiresAtMs || Date.now() >= expiresAtMs) {
      return false
    }

    const required = normalizeScope(requiredScope)
    if (required.length === 0) {
      return true
    }

    return required.every((scope) => state.scope.includes(scope))
  },
  getRemainingMs: () => {
    const expiresAtMs = parseExpiresAtMs(get().expiresAt)
    if (!expiresAtMs) {
      return 0
    }
    return Math.max(0, expiresAtMs - Date.now())
  },
}))
