import type { GroupChainState, GroupMemberRecord, GroupRecord } from "@claw-network/client/protocol"
import type { PaginationMeta } from "@/lib/telagent-client"
import { create } from "zustand"

import { useConnectionStore } from "@/stores/connection"

interface GroupStore {
  groupsById: Record<string, GroupRecord>
  membersByGroupId: Record<string, GroupMemberRecord[]>
  memberPaginationByGroupId: Record<string, PaginationMeta | undefined>
  chainStateByGroupId: Record<string, GroupChainState>
  loadingByGroupId: Record<string, boolean>
  errorByGroupId: Record<string, string | undefined>
  ensureGroup: (groupId: string, force?: boolean) => Promise<GroupRecord | null>
  ensureChainState: (groupId: string, force?: boolean) => Promise<GroupChainState | null>
  loadMembers: (
    groupId: string,
    options?: {
      view?: "all" | "pending" | "finalized"
      page?: number
      perPage?: number
    },
  ) => Promise<void>
  loadBundle: (groupId: string) => Promise<void>
  clear: () => void
}

function normalizeGroupId(raw: string): string {
  return raw.trim()
}

export const useGroupStore = create<GroupStore>((set, get) => ({
  groupsById: {},
  membersByGroupId: {},
  memberPaginationByGroupId: {},
  chainStateByGroupId: {},
  loadingByGroupId: {},
  errorByGroupId: {},
  ensureGroup: async (groupId, force = false) => {
    const normalizedGroupId = normalizeGroupId(groupId)
    if (!normalizedGroupId) {
      return null
    }

    const cached = get().groupsById[normalizedGroupId]
    if (cached && !force) {
      return cached
    }

    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      set((state) => ({
        errorByGroupId: {
          ...state.errorByGroupId,
          [normalizedGroupId]: "SDK not connected",
        },
      }))
      return null
    }

    set((state) => ({
      loadingByGroupId: {
        ...state.loadingByGroupId,
        [normalizedGroupId]: true,
      },
      errorByGroupId: {
        ...state.errorByGroupId,
        [normalizedGroupId]: undefined,
      },
    }))

    try {
      const group = await sdk.groups.get(normalizedGroupId)
      set((state) => ({
        groupsById: {
          ...state.groupsById,
          [normalizedGroupId]: group,
        },
        loadingByGroupId: {
          ...state.loadingByGroupId,
          [normalizedGroupId]: false,
        },
      }))
      return group
    } catch (error) {
      set((state) => ({
        loadingByGroupId: {
          ...state.loadingByGroupId,
          [normalizedGroupId]: false,
        },
        errorByGroupId: {
          ...state.errorByGroupId,
          [normalizedGroupId]: error instanceof Error ? error.message : String(error),
        },
      }))
      return null
    }
  },
  ensureChainState: async (groupId, force = false) => {
    const normalizedGroupId = normalizeGroupId(groupId)
    if (!normalizedGroupId) {
      return null
    }

    const cached = get().chainStateByGroupId[normalizedGroupId]
    if (cached && !force) {
      return cached
    }

    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      return null
    }

    try {
      const chainState = await sdk.groups.getChainState(normalizedGroupId)
      set((state) => ({
        chainStateByGroupId: {
          ...state.chainStateByGroupId,
          [normalizedGroupId]: chainState,
        },
      }))
      return chainState
    } catch (error) {
      set((state) => ({
        errorByGroupId: {
          ...state.errorByGroupId,
          [normalizedGroupId]: error instanceof Error ? error.message : String(error),
        },
      }))
      return null
    }
  },
  loadMembers: async (groupId, options) => {
    const normalizedGroupId = normalizeGroupId(groupId)
    if (!normalizedGroupId) {
      return
    }

    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      return
    }

    const page = options?.page ?? 1
    const perPage = options?.perPage ?? 20
    const view = options?.view ?? "all"

    try {
      const envelope = await sdk.groups.listMembers(normalizedGroupId, {
        page,
        perPage,
        view,
      })
      set((state) => ({
        membersByGroupId: {
          ...state.membersByGroupId,
          [normalizedGroupId]: envelope.data,
        },
        memberPaginationByGroupId: {
          ...state.memberPaginationByGroupId,
          [normalizedGroupId]: envelope.meta.pagination,
        },
      }))
    } catch (error) {
      set((state) => ({
        errorByGroupId: {
          ...state.errorByGroupId,
          [normalizedGroupId]: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  },
  loadBundle: async (groupId) => {
    const normalizedGroupId = normalizeGroupId(groupId)
    if (!normalizedGroupId) {
      return
    }

    await Promise.all([
      get().ensureGroup(normalizedGroupId),
      get().ensureChainState(normalizedGroupId),
      get().loadMembers(normalizedGroupId, {
        view: "all",
        page: 1,
        perPage: 20,
      }),
    ])
  },
  clear: () => {
    set({
      groupsById: {},
      membersByGroupId: {},
      memberPaginationByGroupId: {},
      chainStateByGroupId: {},
      loadingByGroupId: {},
      errorByGroupId: {},
    })
  },
}))
