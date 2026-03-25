import type { AgentIdentityView } from "@/lib/telagent-client"
import type { SelfProfile, PeerProfile } from "@claw-network/client/protocol"
import { create } from "zustand"

import { useConnectionStore } from "@/stores/connection"

interface IdentityStore {
  self: AgentIdentityView | null
  selfProfile: SelfProfile | null
  loading: boolean
  error?: string
  loadSelf: () => Promise<void>
  loadSelfProfile: () => Promise<void>
  updateSelfProfile: (input: Partial<Pick<SelfProfile, "nickname" | "avatarUrl" | "nodeUrl">>) => Promise<void>
  uploadAvatar: (data: string, mimeType: string) => Promise<string>
  clear: () => void
}

export const useIdentityStore = create<IdentityStore>((set, get) => ({
  self: null,
  selfProfile: null,
  loading: false,
  error: undefined,
  loadSelf: async () => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      set({ self: null, loading: false, error: "SDK not connected" })
      return
    }

    set({ loading: true, error: undefined })
    try {
      const self = await sdk.identity.getSelfIdentity()
      set({ self, loading: false, error: undefined })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
  loadSelfProfile: async () => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) return
    try {
      const selfProfile = await sdk.profile.getSelf()
      set({ selfProfile })
    } catch {
      // non-fatal — profile may not be configured yet
    }
  },
  updateSelfProfile: async (input) => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) throw new Error("SDK not connected")
    const updated = await sdk.profile.updateSelf(input)
    set({ selfProfile: updated })
  },
  uploadAvatar: async (data, mimeType) => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) throw new Error("SDK not connected")
    const { avatarUrl } = await sdk.profile.uploadAvatar(data, mimeType)
    // Refresh profile to get updated avatarUrl
    const updated = await sdk.profile.getSelf()
    set({ selfProfile: updated })
    return avatarUrl
  },
  clear: () => {
    set({ self: null, selfProfile: null, loading: false, error: undefined })
  },
}))

// Re-export PeerProfile so consumers can import from this store module
export type { PeerProfile }
