import { beforeEach, describe, expect, it } from "vitest"

import type { Envelope } from "@claw-network/client/protocol"

import { useMessageStore } from "@/stores/message"

function makeEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    envelopeId: overrides.envelopeId ?? "env-1",
    conversationId: overrides.conversationId ?? "direct:test",
    conversationType: overrides.conversationType ?? "direct",
    routeHint: overrides.routeHint ?? {
      targetDomain: "local",
      targetDid: "did:claw:test",
      mailboxKeyId: "key",
    },
    sealedHeader: overrides.sealedHeader ?? "header",
    seq: overrides.seq ?? 1n,
    ciphertext: overrides.ciphertext ?? "cipher",
    contentType: overrides.contentType ?? "text",
    sentAtMs: overrides.sentAtMs ?? 1,
    ttlSec: overrides.ttlSec ?? 60,
    provisional: overrides.provisional,
    epoch: overrides.epoch,
    attachmentManifestHash: overrides.attachmentManifestHash,
  }
}

describe("useMessageStore", () => {
  beforeEach(() => {
    useMessageStore.getState().clear()
  })

  it("deduplicates envelopeId during upsert", () => {
    const first = makeEnvelope({ envelopeId: "env-1", seq: 1n })
    const duplicate = makeEnvelope({ envelopeId: "env-1", seq: 1n, ciphertext: "updated" })
    const second = makeEnvelope({ envelopeId: "env-2", seq: 2n })

    useMessageStore.getState().upsertMessages("direct:test", [first], "1")
    useMessageStore.getState().upsertMessages("direct:test", [duplicate, second], "2")

    const messages = useMessageStore.getState().getMessages("direct:test")
    expect(messages).toHaveLength(2)
    expect(messages[0].ciphertext).toBe("updated")
    expect(messages[1].envelopeId).toBe("env-2")
  })

  it("preserves pending status when the same envelope is pulled back from the node", () => {
    useMessageStore.getState().upsertLocalMessage("direct:test", {
      ...makeEnvelope(),
      deliveryStatus: "pending",
    })

    useMessageStore.getState().upsertMessages("direct:test", [makeEnvelope({ ciphertext: "updated" })], "1")

    const [message] = useMessageStore.getState().getMessages("direct:test")
    expect(message.ciphertext).toBe("updated")
    expect(message.deliveryStatus).toBe("pending")
  })

  it("marks a message as sent when a delivery signal arrives", () => {
    useMessageStore.getState().upsertLocalMessage("direct:test", {
      ...makeEnvelope(),
      deliveryStatus: "pending",
    })

    useMessageStore.getState().markSent("env-1")

    const [message] = useMessageStore.getState().getMessages("direct:test")
    expect(message.deliveryStatus).toBe("sent")
    expect(message.lastError).toBeUndefined()
  })
})
