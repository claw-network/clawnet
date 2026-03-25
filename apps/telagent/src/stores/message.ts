import type { Envelope } from "@claw-network/client/protocol"
import { create } from "zustand"

import type { MessageWithStatus } from "@/types/webapp"

interface MessageStore {
  messagesByConversation: Record<string, MessageWithStatus[]>
  cursorsByConversation: Record<string, string | null>
  globalCursor: string | null
  loadingByConversation: Record<string, boolean>
  upsertMessages: (conversationId: string, items: Envelope[], cursor: string | null) => void
  mergeGlobalMessages: (items: Envelope[], cursor: string | null) => void
  upsertLocalMessage: (conversationId: string, message: MessageWithStatus) => void
  markFailed: (conversationId: string, envelopeId: string, errorMessage?: string) => void
  markPending: (conversationId: string, envelopeId: string) => void
  markSent: (envelopeId: string) => void
  removeConversation: (conversationId: string) => void
  setLoading: (conversationId: string, loading: boolean) => void
  getMessages: (conversationId: string) => MessageWithStatus[]
  clear: () => void
}

function compareMessages(left: MessageWithStatus, right: MessageWithStatus): number {
  if (left.sentAtMs !== right.sentAtMs) {
    return left.sentAtMs - right.sentAtMs
  }
  return left.envelopeId.localeCompare(right.envelopeId)
}

function mergeEnvelopes(
  existing: MessageWithStatus[],
  incoming: Array<Envelope | MessageWithStatus>,
): MessageWithStatus[] {
  const map = new Map<string, MessageWithStatus>()
  for (const message of existing) {
    map.set(message.envelopeId, message)
  }

  for (const rawMessage of incoming) {
    const previous = map.get(rawMessage.envelopeId)
    const explicitStatus = (rawMessage as MessageWithStatus).deliveryStatus
    const deliveryStatus = explicitStatus
      ?? (previous?.deliveryStatus && previous.deliveryStatus !== "sent"
        ? previous.deliveryStatus
        : "sent")
    const next = {
      ...(previous ?? {}),
      ...rawMessage,
      deliveryStatus,
      lastError: deliveryStatus === "failed"
        ? ((rawMessage as MessageWithStatus).lastError ?? previous?.lastError)
        : undefined,
      clientRawCiphertext:
        (rawMessage as MessageWithStatus).clientRawCiphertext
        ?? previous?.clientRawCiphertext,
      clientDisplayText:
        (rawMessage as MessageWithStatus).clientDisplayText
        ?? previous?.clientDisplayText,
    }
    map.set(rawMessage.envelopeId, next)
  }

  return [...map.values()].sort(compareMessages)
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messagesByConversation: {},
  cursorsByConversation: {},
  globalCursor: null,
  loadingByConversation: {},
  upsertMessages: (conversationId, items, cursor) => {
    const existing = get().messagesByConversation[conversationId] ?? []
    const merged = mergeEnvelopes(existing, items)

    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: merged,
      },
      cursorsByConversation: {
        ...state.cursorsByConversation,
        [conversationId]: cursor,
      },
    }))
  },
  mergeGlobalMessages: (items, cursor) => {
    if (items.length === 0 && cursor === get().globalCursor) {
      return
    }

    const grouped = new Map<string, Envelope[]>()
    for (const message of items) {
      const bucket = grouped.get(message.conversationId)
      if (bucket) {
        bucket.push(message)
      } else {
        grouped.set(message.conversationId, [message])
      }
    }

    set((state) => {
      const messagesByConversation = { ...state.messagesByConversation }
      for (const [conversationId, envelopes] of grouped.entries()) {
        const existing = messagesByConversation[conversationId] ?? []
        messagesByConversation[conversationId] = mergeEnvelopes(existing, envelopes)
      }
      return {
        messagesByConversation,
        globalCursor: cursor,
      }
    })
  },
  upsertLocalMessage: (conversationId, message) => {
    set((state) => {
      const existing = state.messagesByConversation[conversationId] ?? []
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: mergeEnvelopes(existing, [message]),
        },
      }
    })
  },
  markFailed: (conversationId, envelopeId, errorMessage) => {
    set((state) => {
      const existing = state.messagesByConversation[conversationId] ?? []
      const updated = existing.map((message) => {
        if (message.envelopeId !== envelopeId) {
          return message
        }
        return {
          ...message,
          deliveryStatus: "failed" as const,
          lastError: errorMessage,
        }
      })
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: updated,
        },
      }
    })
  },
  markPending: (conversationId, envelopeId) => {
    set((state) => {
      const existing = state.messagesByConversation[conversationId] ?? []
      const updated = existing.map((message) => {
        if (message.envelopeId !== envelopeId) {
          return message
        }
        return {
          ...message,
          deliveryStatus: "pending" as const,
          lastError: undefined,
        }
      })
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: updated,
        },
      }
    })
  },
  markSent: (envelopeId) => {
    set((state) => {
      let changed = false
      const messagesByConversation = Object.fromEntries(
        Object.entries(state.messagesByConversation).map(([conversationId, messages]) => {
          const updated = messages.map((message) => {
            if (message.envelopeId !== envelopeId) {
              return message
            }
            changed = true
            return {
              ...message,
              deliveryStatus: "sent" as const,
              lastError: undefined,
            }
          })
          return [conversationId, updated]
        }),
      )

      if (!changed) {
        return state
      }

      return {
        messagesByConversation,
      }
    })
  },
  removeConversation: (conversationId) => {
    set((state) => {
      const messagesByConversation = { ...state.messagesByConversation }
      const cursorsByConversation = { ...state.cursorsByConversation }
      const loadingByConversation = { ...state.loadingByConversation }
      delete messagesByConversation[conversationId]
      delete cursorsByConversation[conversationId]
      delete loadingByConversation[conversationId]
      return {
        messagesByConversation,
        cursorsByConversation,
        loadingByConversation,
      }
    })
  },
  setLoading: (conversationId, loading) => {
    set((state) => ({
      loadingByConversation: {
        ...state.loadingByConversation,
        [conversationId]: loading,
      },
    }))
  },
  getMessages: (conversationId) => {
    return get().messagesByConversation[conversationId] ?? []
  },
  clear: () => {
    set({
      messagesByConversation: {},
      cursorsByConversation: {},
      globalCursor: null,
      loadingByConversation: {},
    })
  },
}))
