/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest"

import { useConnectionStore } from "@/stores/connection"
import { useGroupStore } from "@/stores/group"

describe("useGroupStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useGroupStore.getState().clear()
  })

  it("loads group bundle and caches group lookup", async () => {
    const groupId = "0x" + "1".repeat(64)
    const getGroup = vi.fn(async () => ({
      groupId,
      creatorDid: "did:claw:zAlice",
      creatorDidHash: "0x" + "2".repeat(64),
      groupDomain: "alpha.tel",
      domainProofHash: "0x" + "3".repeat(64),
      initialMlsStateHash: "0x" + "4".repeat(64),
      state: "ACTIVE" as const,
      createdAtMs: 1_000,
    }))
    const getGroupChainState = vi.fn(async () => ({
      groupId,
      state: "ACTIVE" as const,
      finalizedTxHash: "0x" + "5".repeat(64),
      blockNumber: 10,
      updatedAtMs: 2_000,
    }))
    const listGroupMembers = vi.fn(async () => ({
      data: [
        {
          groupId,
          did: "did:claw:zBob",
          didHash: "0x" + "6".repeat(64),
          state: "FINALIZED" as const,
          joinedAtMs: 3_000,
        },
      ],
      meta: {
        pagination: {
          page: 1,
          perPage: 20,
          total: 1,
          totalPages: 1,
        },
      },
      links: {
        self: `/api/v1/groups/${groupId}/members?page=1&per_page=20`,
      },
    }))

    vi.spyOn(useConnectionStore, "getState").mockReturnValue({
      sdk: {
        groups: {
          get: getGroup,
          getChainState: getGroupChainState,
          listMembers: listGroupMembers,
        },
      },
    } as never)

    await useGroupStore.getState().loadBundle(groupId)
    const cached = await useGroupStore.getState().ensureGroup(groupId)

    expect(cached?.groupId).toBe(groupId)
    expect(useGroupStore.getState().membersByGroupId[groupId]).toHaveLength(1)
    expect(useGroupStore.getState().chainStateByGroupId[groupId]?.state).toBe("ACTIVE")
    expect(getGroup).toHaveBeenCalledTimes(1)
    expect(getGroupChainState).toHaveBeenCalledTimes(1)
    expect(listGroupMembers).toHaveBeenCalledTimes(1)
  })
})
