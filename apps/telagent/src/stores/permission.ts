import { create } from "zustand"

import { useConnectionStore } from "@/stores/connection"
import type { InterventionScope, OwnerMode, OwnerPermissions } from "@/types/webapp"

interface PermissionStore extends OwnerPermissions {
  loading: boolean
  error?: string
  refresh: () => Promise<void>
  clear: () => void
  can: (scope: InterventionScope) => boolean
}

const DEFAULT_PERMISSIONS: OwnerPermissions = {
  mode: "observer",
  interventionScopes: [],
  privateConversations: [],
}

export const usePermissionStore = create<PermissionStore>((set, get) => ({
  ...DEFAULT_PERMISSIONS,
  loading: false,
  error: undefined,
  refresh: async () => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      set({ ...DEFAULT_PERMISSIONS, loading: false, error: "SDK not connected" })
      return
    }

    set({ loading: true, error: undefined })

    try {
      const data = (await sdk.identity.getOwnerPermissions()) as OwnerPermissions

      const mode: OwnerMode = data.mode === "intervener" ? "intervener" : "observer"
      set({
        mode,
        interventionScopes: data.interventionScopes ?? [],
        privateConversations: data.privateConversations ?? [],
        loading: false,
        error: undefined,
      })
    } catch {
      set({ ...DEFAULT_PERMISSIONS, loading: false, error: undefined })
    }
  },
  clear: () => {
    set({ ...DEFAULT_PERMISSIONS, loading: false, error: undefined })
  },
  can: (scope) => {
    const state = get()
    return state.mode === "intervener" && state.interventionScopes.includes(scope)
  },
}))
