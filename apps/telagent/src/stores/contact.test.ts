/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest"

import { useConnectionStore } from "@/stores/connection"
import { useContactStore } from "@/stores/contact"

describe("useContactStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useContactStore.getState().clear()
  })

  it("reuses cached identity and avoids duplicate resolve calls", async () => {
    const getIdentity = vi.fn(async (did: string) => ({
      did,
      didHash: `hash-${did}`,
      controller: "0x1",
      publicKey: "0x2",
      isActive: true,
      resolvedAtMs: 1,
      capabilities: ["chat"],
      keyHistory: [],
    }))

    vi.spyOn(useConnectionStore, "getState").mockReturnValue({
      sdk: {
        identity: {
          getIdentity,
        },
      },
    } as never)

    const did = "did:claw:zAlice"
    const first = await useContactStore.getState().resolve(did)
    const second = await useContactStore.getState().resolve(did)

    expect(first?.did).toBe(did)
    expect(second?.did).toBe(did)
    expect(getIdentity).toHaveBeenCalledTimes(1)
  })
})
