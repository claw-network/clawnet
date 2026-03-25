import { useMemo } from "react"
import { toast } from "sonner"

import type { BaseContentType, Envelope } from "@claw-network/client/protocol"

import { useConnectionStore } from "@/stores/connection"
import { useConversationStore } from "@/stores/conversation"
import { useGroupStore } from "@/stores/group"
import { useIdentityStore } from "@/stores/identity"
import { useMessageStore } from "@/stores/message"
import type { MessageWithStatus } from "@/types/webapp"
import { encodeUtf8Hex } from "@/lib/message-content"

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60
const DEFAULT_MAILBOX_KEY_ID = "webapp-default"

interface SendTextInput {
  text: string
  conversationId?: string
}

interface SendAttachmentInput {
  file: File
  conversationId?: string
}

function resolveNodeDomain(nodeUrl: string): string {
  try {
    return new URL(nodeUrl).hostname || "localhost"
  } catch {
    return "localhost"
  }
}

function randomEnvelopeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `env-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function nextSequence(messages: MessageWithStatus[]): bigint {
  return messages.reduce((max, item) => (item.seq > max ? item.seq : max), 0n) + 1n
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  const bytes = new Uint8Array(digest)
  let hex = "0x"
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0")
  }
  return hex
}

export function useMessageSender() {
  const sdk = useConnectionStore((state) => state.sdk)
  const nodeUrl = useConnectionStore((state) => state.nodeUrl)
  const selfDid = useIdentityStore((state) => state.self?.did)
  const selectedConversationId = useConversationStore((state) => state.selectedConversationId)
  const conversations = useConversationStore((state) => state.conversations)
  const mergeConversations = useConversationStore((state) => state.mergeFromEnvelopes)
  const markRead = useConversationStore((state) => state.markRead)
  const groupsById = useGroupStore((state) => state.groupsById)

  const upsertLocalMessage = useMessageStore((state) => state.upsertLocalMessage)
  const upsertMessages = useMessageStore((state) => state.upsertMessages)
  const markFailed = useMessageStore((state) => state.markFailed)
  const markPending = useMessageStore((state) => state.markPending)
  const markSent = useMessageStore((state) => state.markSent)

  const helpers = useMemo(() => {
    const resolveConversation = (conversationId?: string) => {
      const targetConversationId = conversationId ?? selectedConversationId
      if (!targetConversationId) {
        return null
      }
      return conversations.find((item) => item.conversationId === targetConversationId) ?? null
    }

    const resolveTargetDomain = (conversation: NonNullable<ReturnType<typeof resolveConversation>>): string => {
      if (conversation.conversationType === "group") {
        const groupId = conversation.groupId
          ?? (conversation.conversationId.startsWith("group:")
            ? conversation.conversationId.slice("group:".length)
            : conversation.conversationId)
        const foundGroup = groupsById[groupId]
        if (foundGroup?.groupDomain) {
          return foundGroup.groupDomain
        }
      }
      return resolveNodeDomain(nodeUrl)
    }

    const resolveTargetDid = (conversation: NonNullable<ReturnType<typeof resolveConversation>>): string => {
      if (conversation.peerDid) {
        return conversation.peerDid
      }
      if (conversation.conversationType === "group") {
        const groupId = conversation.groupId
          ?? (conversation.conversationId.startsWith("group:")
            ? conversation.conversationId.slice("group:".length)
            : conversation.conversationId)
        const foundGroup = groupsById[groupId]
        if (foundGroup?.creatorDid) {
          return foundGroup.creatorDid
        }
      }
      throw new Error("Unable to resolve targetDid for this conversation")
    }

    return {
      resolveConversation,
      resolveTargetDomain,
      resolveTargetDid,
    }
  }, [conversations, groupsById, nodeUrl, selectedConversationId])

  const sendEnvelope = async (params: {
    conversationId: string
    conversationType: "direct" | "group"
    contentType: BaseContentType
    displayText: string
    rawCiphertext: string
    attachmentManifestHash?: string
    envelopeId?: string
    targetDomain: string
    targetDid: string
    mailboxKeyId?: string
    sealedHeader?: string
  }) => {
    if (!sdk || !selfDid) {
      throw new Error("SDK or self DID is not ready")
    }

    const existing = useMessageStore.getState().getMessages(params.conversationId)
    const envelopeId = params.envelopeId ?? randomEnvelopeId()
    const seq = nextSequence(existing)
    const now = Date.now()

    const localEnvelope: MessageWithStatus = {
      envelopeId,
      conversationId: params.conversationId,
      conversationType: params.conversationType,
      routeHint: {
        targetDomain: params.targetDomain,
        targetDid: params.targetDid,
        mailboxKeyId: params.mailboxKeyId ?? DEFAULT_MAILBOX_KEY_ID,
      },
      sealedHeader: params.sealedHeader ?? encodeUtf8Hex(selfDid),
      seq,
      ciphertext: params.displayText,
      contentType: params.contentType,
      attachmentManifestHash: params.attachmentManifestHash,
      sentAtMs: now,
      ttlSec: DEFAULT_TTL_SECONDS,
      deliveryStatus: "pending",
      clientRawCiphertext: params.rawCiphertext,
      clientDisplayText: params.displayText,
      provisional: false,
    }

    upsertLocalMessage(params.conversationId, localEnvelope)

    try {
      const result = await sdk.messages.send({
        envelopeId,
        senderDid: selfDid,
        conversationId: params.conversationId,
        conversationType: params.conversationType,
        targetDomain: params.targetDomain,
        targetDid: params.targetDid,
        mailboxKeyId: localEnvelope.routeHint.mailboxKeyId,
        sealedHeader: localEnvelope.sealedHeader,
        ciphertext: params.rawCiphertext,
        contentType: params.contentType,
        attachmentManifestHash: params.attachmentManifestHash,
        ttlSec: DEFAULT_TTL_SECONDS,
      })
      const saved = result.envelope;

      const cursor = useMessageStore.getState().cursorsByConversation[params.conversationId] ?? null
      upsertMessages(params.conversationId, [saved], cursor)
      if (result.p2pDelivered) {
        markSent(envelopeId)
      } else {
        markPending(params.conversationId, envelopeId)
      }
      mergeConversations([saved])
      markRead(params.conversationId)
      return saved
    } catch (error) {
      markFailed(
        params.conversationId,
        envelopeId,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }
  }

  const sendText = async (input: SendTextInput): Promise<Envelope | null> => {
    const text = input.text.trim()
    if (!text) {
      return null
    }

    const conversation = helpers.resolveConversation(input.conversationId)
    if (!conversation) {
      throw new Error("Conversation is not selected")
    }
    const targetDomain = helpers.resolveTargetDomain(conversation)
    const targetDid = helpers.resolveTargetDid(conversation)
    return sendEnvelope({
      conversationId: conversation.conversationId,
      conversationType: conversation.conversationType,
      contentType: "text",
      displayText: text,
      rawCiphertext: encodeUtf8Hex(text),
      targetDomain,
      targetDid,
    })
  }

  const sendAttachment = async (input: SendAttachmentInput): Promise<Envelope | null> => {
    if (!sdk) {
      throw new Error("SDK is not connected")
    }

    const conversation = helpers.resolveConversation(input.conversationId)
    if (!conversation) {
      throw new Error("Conversation is not selected")
    }

    const targetDomain = helpers.resolveTargetDomain(conversation)
    const targetDid = helpers.resolveTargetDid(conversation)
    const contentType: BaseContentType = input.file.type.startsWith("image/") ? "image" : "file"

    const fileBuffer = await input.file.arrayBuffer()
    const checksum = await sha256Hex(fileBuffer)
    const initialized = await sdk.attachments.initUpload({
      filename: input.file.name,
      contentType: input.file.type || "application/octet-stream",
      sizeBytes: input.file.size,
      manifestHash: checksum,
    })

    // Upload file bytes via binary PUT.
    // Build the URL from the webapp's own nodeUrl (not the server's uploadUrl)
    // because the server may return an internal address unreachable from the browser.
    const putUrl = `${nodeUrl.replace(/\/$/, '')}/api/v1/attachments/${encodeURIComponent(initialized.objectKey)}`
    await fetch(putUrl, {
      method: "PUT",
      body: new Uint8Array(fileBuffer),
    })

    const completed = await sdk.attachments.completeUpload({
      objectKey: initialized.objectKey,
      manifestHash: checksum,
      checksum,
      fileContentType: input.file.type || "application/octet-stream",
      targetDid,
    })

    // Wire format: sender's public URL so the receiver can always fetch the image
    // directly from the sender's node — no dependency on P2P relay completing first.
    // P2P relay still runs in the background (triggered by targetDid in completeAttachmentUpload)
    // and if it succeeds the receiver's node will also have a local copy for faster future access.
    const rawPayloadText = `${nodeUrl.replace(/\/$/, "")}/api/v1/attachments/${encodeURIComponent(initialized.objectKey)}`
    const displayText = contentType === "image"
      ? URL.createObjectURL(input.file)  // local blob for sender's immediate preview
      : input.file.name

    return sendEnvelope({
      conversationId: conversation.conversationId,
      conversationType: conversation.conversationType,
      contentType,
      displayText,
      rawCiphertext: encodeUtf8Hex(rawPayloadText),
      attachmentManifestHash: completed.manifestHash,
      targetDomain,
      targetDid,
    })
  }

  const retryMessage = async (message: MessageWithStatus): Promise<void> => {
    if (!sdk) {
      throw new Error("SDK is not connected")
    }
    if (!selfDid) {
      throw new Error("Missing self DID")
    }

    const rawCiphertext = message.clientRawCiphertext
    if (!rawCiphertext) {
      throw new Error("Missing raw ciphertext for retry")
    }

    markPending(message.conversationId, message.envelopeId)
    try {
      const result = await sdk.messages.send({
        envelopeId: message.envelopeId,
        senderDid: selfDid,
        conversationId: message.conversationId,
        conversationType: message.conversationType,
        targetDomain: message.routeHint.targetDomain,
        targetDid: message.routeHint.targetDid,
        mailboxKeyId: message.routeHint.mailboxKeyId,
        sealedHeader: /^0x[0-9a-fA-F]+$/.test(message.sealedHeader)
          ? message.sealedHeader
          : encodeUtf8Hex(selfDid),
        ciphertext: rawCiphertext,
        contentType: message.contentType as BaseContentType,
        attachmentManifestHash: message.attachmentManifestHash,
        ttlSec: message.ttlSec,
      })
      const saved = result.envelope;

      const cursor = useMessageStore.getState().cursorsByConversation[message.conversationId] ?? null
      upsertMessages(message.conversationId, [saved], cursor)
      if (result.p2pDelivered) {
        markSent(message.envelopeId)
      } else {
        markPending(message.conversationId, message.envelopeId)
      }
      mergeConversations([saved])
      markRead(message.conversationId)
    } catch (error) {
      markFailed(
        message.conversationId,
        message.envelopeId,
        error instanceof Error ? error.message : String(error),
      )
      toast.error("Retry failed")
      throw error
    }
  }

  return {
    sendText,
    sendAttachment,
    retryMessage,
  }
}
