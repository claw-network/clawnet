import { beforeEach, describe, expect, it } from "vitest"

import { useWalletStore } from "@/stores/wallet"

describe("useWalletStore", () => {
  beforeEach(() => {
    useWalletStore.setState({
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
  })

  it("upserts escrow by id and keeps latest updatedAt first", () => {
    useWalletStore.getState().upsertEscrow({
      id: "escrow-1",
      status: "created",
      amount: 10,
      updatedAtMs: 10,
      raw: {},
    })

    useWalletStore.getState().upsertEscrow({
      id: "escrow-2",
      status: "created",
      amount: 5,
      updatedAtMs: 20,
      raw: {},
    })

    useWalletStore.getState().upsertEscrow({
      id: "escrow-1",
      status: "released",
      amount: 10,
      updatedAtMs: 30,
      raw: {},
    })

    const escrows = useWalletStore.getState().escrows
    expect(escrows).toHaveLength(2)
    expect(escrows[0].id).toBe("escrow-1")
    expect(escrows[0].status).toBe("released")
    expect(escrows[1].id).toBe("escrow-2")
  })
})
