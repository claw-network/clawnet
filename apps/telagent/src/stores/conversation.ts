import type { Envelope } from "@claw-network/client/protocol"
import { create } from "zustand"

import { useConnectionStore } from "@/stores/connection"
import { usePermissionStore } from "@/stores/permission"
import type { ConversationSummary } from "@/types/webapp"
import { readableCiphertext } from "@/lib/message-content"

interface ConversationStore {
  conversations: ConversationSummary[]
  selectedConversationId: string | null
  searchQuery: string
  refreshFromApi: () => Promise<void>
  setSelectedConversationId: (conversationId: string | null) => void
  setSearchQuery: (query: string) => void
  setConversations: (items: ConversationSummary[]) => void
  upsertConversation: (item: ConversationSummary) => void
  removeConversation: (conversationId: string) => void
  deleteConversation: (conversationId: string) => Promise<void>
  mergeFromEnvelopes: (items: Envelope[]) => void
  markRead: (conversationId: string) => void
}

function deriveConversationType(conversationId: string, fallback: "direct" | "group"): "direct" | "group" {
  if (conversationId.startsWith("group:")) {
    return "group"
  }
  if (conversationId.startsWith("direct:")) {
    return "direct"
  }
  return fallback
}

function deriveDisplayName(conversationId: string, conversationType: "direct" | "group"): string {
  if (conversationType === "group") {
    const groupId = conversationId.startsWith("group:") ? conversationId.slice("group:".length) : conversationId
    return `Group ${groupId.slice(0, 8)}`
  }

  const parts = conversationId.split(":")
  if (parts.length >= 2) {
    return parts.slice(1).join(":")
  }
  return `DM ${conversationId.slice(0, 8)}`
}

function previewForEnvelope(envelope: Envelope, isPrivate: boolean): string | null {
  if (isPrivate) {
    return null
  }

  if (envelope.contentType === "control") {
    return "[control]"
  }

  if (envelope.contentType === "text") {
    return readableCiphertext(envelope.ciphertext).slice(0, 36)
  }

  return `[${envelope.contentType}]`
}

export const useConversationStore = create<ConversationStore>()(
    (set, get) => ({
  conversations: [],
  selectedConversationId: null,
  searchQuery: "",
  refreshFromApi: async () => {
    const sdk = useConnectionStore.getState().sdk
    if (!sdk) {
      return
    }

    try {
      const envelope = await sdk.conversations.list({
        page: 1,
        perPage: 100,
        sort: "last_message",
      })
      const apiItems = envelope.data as ConversationSummary[]
      const privateSet = new Set(usePermissionStore.getState().privateConversations)

      const normalized = apiItems.map((item) => {
        const isPrivate = item.private || privateSet.has(item.conversationId)
        return {
          ...item,
          private: isPrivate,
          lastMessagePreview: isPrivate ? null : item.lastMessagePreview,
        }
      })
      normalized.sort(
        (left, right) => (right.lastMessageAtMs ?? 0) - (left.lastMessageAtMs ?? 0),
      )
      set({ conversations: normalized })
    } catch {
      // keep existing conversations on error
    }
  },
  setSelectedConversationId: (selectedConversationId) => {
    set({ selectedConversationId })
  },
  setSearchQuery: (searchQuery) => {
    set({ searchQuery })
  },
  setConversations: (items) => {
    const privateSet = new Set(usePermissionStore.getState().privateConversations)
    const normalized = items.map((item) => ({
      ...item,
      private: item.private || privateSet.has(item.conversationId),
      lastMessagePreview: item.private || privateSet.has(item.conversationId) ? null : item.lastMessagePreview,
    }))

    normalized.sort((left, right) => (right.lastMessageAtMs ?? 0) - (left.lastMessageAtMs ?? 0))
    set({ conversations: normalized })
  },
  upsertConversation: (item) => {
    const privateSet = new Set(usePermissionStore.getState().privateConversations)
    const byConversation = new Map(get().conversations.map((conversation) => [conversation.conversationId, conversation]))
    const isPrivate = item.private || privateSet.has(item.conversationId)

    byConversation.set(item.conversationId, {
      ...item,
      private: isPrivate,
      lastMessagePreview: isPrivate ? null : item.lastMessagePreview,
    })

    const merged = [...byConversation.values()].sort((left, right) => (right.lastMessageAtMs ?? 0) - (left.lastMessageAtMs ?? 0))
    set({ conversations: merged })
  },
  removeConversation: (conversationId) => {
    const next = get().conversations.filter((item) => item.conversationId !== conversationId)
    set({
      conversations: next,
      selectedConversationId:
        get().selectedConversationId === conversationId
          ? null
          : get().selectedConversationId,
    })
  },
  deleteConversation: async (conversationId) => {
    const sdk = useConnectionStore.getState().sdk
    if (sdk) {
      await sdk.conversations.delete(conversationId)
    }
    const next = get().conversations.filter((item) => item.conversationId !== conversationId)
    set({
      conversations: next,
      selectedConversationId:
        get().selectedConversationId === conversationId
          ? null
          : get().selectedConversationId,
    })
  },
  mergeFromEnvelopes: (items) => {
    if (items.length === 0) {
      return
    }

    const byConversation = new Map(get().conversations.map((item) => [item.conversationId, item]))
    const privateSet = new Set(usePermissionStore.getState().privateConversations)

    for (const envelope of items) {
      const conversationId = envelope.conversationId
      const conversationType = deriveConversationType(conversationId, envelope.conversationType)
      const isPrivate = privateSet.has(conversationId)
      const previous = byConversation.get(conversationId)

      if (!previous) {
        byConversation.set(conversationId, {
          conversationId,
          conversationType,
          displayName: deriveDisplayName(conversationId, conversationType),
          groupId: conversationType === "group" ? conversationId.replace(/^group:/, "") : undefined,
          lastMessagePreview: previewForEnvelope(envelope, isPrivate),
          lastMessageAtMs: envelope.sentAtMs,
          unreadCount: 1,
          private: isPrivate,
        })
        continue
      }

      const isLatest = (previous.lastMessageAtMs ?? 0) <= envelope.sentAtMs
      byConversation.set(conversationId, {
        ...previous,
        lastMessageAtMs: isLatest ? envelope.sentAtMs : previous.lastMessageAtMs,
        lastMessagePreview: isLatest ? previewForEnvelope(envelope, isPrivate) : previous.lastMessagePreview,
        unreadCount: get().selectedConversationId === conversationId ? 0 : previous.unreadCount + 1,
        private: isPrivate,
      })
    }

    const merged = [...byConversation.values()].sort((left, right) => (right.lastMessageAtMs ?? 0) - (left.lastMessageAtMs ?? 0))
    set({ conversations: merged })
  },
  markRead: (conversationId) => {
    const next = get().conversations.map((item) =>
      item.conversationId === conversationId
        ? {
            ...item,
            unreadCount: 0,
          }
        : item,
    )
    set({ conversations: next })
  },
    }),
)
