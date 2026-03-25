import { useEffect, useRef, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { EventNotification } from "@claw-network/client/protocol"
import { formatApiError, isLikelyNetworkError } from "@/lib/api-error"
import { useConnectionStore } from "@/stores/connection"
import { useConversationStore } from "@/stores/conversation"
import { useContactStore } from "@/stores/contact"
import { useMessageStore } from "@/stores/message"
import { useUIStore } from "@/stores/ui"
import { useEventSource } from "./use-event-source"

const ACTIVE_INTERVAL_MS = 3_000
const IDLE_INTERVAL_MS = 15_000
// When SSE is active, relax polling to save bandwidth (polling becomes fallback only)
const SSE_ACTIVE_INTERVAL_MS = 15_000
const SSE_IDLE_INTERVAL_MS = 60_000

export function usePollMessages() {
  const { t } = useTranslation()
  const sdk = useConnectionStore((state) => state.sdk)
  const nodeUrl = useConnectionStore((state) => state.nodeUrl)
  const sessionToken = useConnectionStore((state) => state.sessionToken)
  const status = useConnectionStore((state) => state.status)
  const markUnreachable = useConnectionStore((state) => state.markUnreachable)
  const selectedConversationId = useConversationStore((state) => state.selectedConversationId)
  const mergeConversations = useConversationStore((state) => state.mergeFromEnvelopes)
  const markRead = useConversationStore((state) => state.markRead)
  const refreshConversations = useConversationStore((state) => state.refreshFromApi)

  const setPollingState = useUIStore((state) => state.setPollingState)

  const upsertMessages = useMessageStore((state) => state.upsertMessages)
  const mergeGlobalMessages = useMessageStore((state) => state.mergeGlobalMessages)
  const markSent = useMessageStore((state) => state.markSent)

  const activeInFlight = useRef(false)
  const globalInFlight = useRef(false)
  const seenRetractionIds = useRef(new Set<string>())
  const lastErrorRef = useRef<{ key: string; at: number }>({ key: "", at: 0 })
  const sseActiveRef = useRef(false)
  // Refs for imperative poll triggers from SSE events
  const pollActiveRef = useRef<(() => void) | undefined>(undefined)
  const pollGlobalRef = useRef<(() => void) | undefined>(undefined)

  // ── SSE event handler ─────────────────────────────────
  const handleSseEvent = useCallback((event: EventNotification) => {
    sseActiveRef.current = true
    switch (event.type) {
      case "new-envelope":
        // Immediately fetch new messages
        pollActiveRef.current?.()
        pollGlobalRef.current?.()
        break
      case "receipt":
        if (event.envelopeId) {
          markSent(event.envelopeId)
        }
        pollGlobalRef.current?.()
        break
      case "conversation-update":
        pollGlobalRef.current?.()
        break
      case "retraction":
        pollGlobalRef.current?.()
        break
      case "profile-update":
        // A peer's profile card arrived — clear cached entry and re-fetch
        // so any open AddContactDialog or contact list picks up the update.
        if (event.sourceDid) {
          useContactStore.setState((s) => {
            const copy = { ...s.peerProfiles }
            delete copy[event.sourceDid!]
            return { peerProfiles: copy }
          })
          void useContactStore.getState().fetchPeerProfile(event.sourceDid).catch(() => null)
        }
        break
    }
  }, [markSent])

  useEventSource(handleSseEvent)

  useEffect(() => {
    if (!sdk || !nodeUrl || status !== "connected") {
      setPollingState("paused")
      return undefined
    }

    let activeTimer: number | undefined
    let globalTimer: number | undefined

    const reportPollingError = (error: unknown, fallback: string) => {
      if (isLikelyNetworkError(error)) {
        markUnreachable(formatApiError(error, fallback))
        return
      }

      const message = formatApiError(error, fallback)
      const now = Date.now()
      if (lastErrorRef.current.key === message && now - lastErrorRef.current.at < 4_000) {
        return
      }
      lastErrorRef.current = { key: message, at: now }
      toast.error(message)
    }

    const pollActiveConversation = async () => {
      if (!selectedConversationId || activeInFlight.current || document.hidden) {
        return
      }
      activeInFlight.current = true
      setPollingState("active")
      try {
        const cursor = useMessageStore.getState().cursorsByConversation[selectedConversationId]
        const result = await sdk.messages.pull({
          conversationId: selectedConversationId,
          cursor: cursor ?? undefined,
          limit: 100,
        })
        upsertMessages(selectedConversationId, result.items, result.cursor)
        mergeConversations(result.items)
        markRead(selectedConversationId)
      } catch (error) {
        reportPollingError(error, t("chat.pollFailed"))
      } finally {
        activeInFlight.current = false
      }
    }

    const pollGlobal = async () => {
      if (globalInFlight.current || document.hidden) {
        return
      }
      globalInFlight.current = true
      if (!selectedConversationId) {
        setPollingState("idle")
      }
      try {
        await refreshConversations()
        const currentGlobalCursor = useMessageStore.getState().globalCursor
        const result = await sdk.messages.pull({
          cursor: currentGlobalCursor ?? undefined,
          limit: 200,
        })
        mergeGlobalMessages(result.items, result.cursor)
        mergeConversations(result.items)
      } catch (error) {
        reportPollingError(error, t("chat.pollFailed"))
      } finally {
        globalInFlight.current = false
      }
    }

    const pollRetracted = async () => {
      if (document.hidden) {
        return
      }

      try {
        const endpoint = new URL("/api/v1/messages/retracted?limit=50", nodeUrl).toString()
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            accept: "application/json",
            ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
          },
          signal: AbortSignal.timeout(5_000),
        })
        if (!response.ok) {
          if (response.status === 401) {
            useConnectionStore.getState().disconnect()
          }
          return
        }
        const payload = (await response.json()) as {
          data?: {
            items?: Array<{ envelopeId: string; conversationId: string }>
          }
        }
        const items = payload.data?.items ?? []
        for (const entry of items) {
          if (seenRetractionIds.current.has(entry.envelopeId)) {
            continue
          }
          seenRetractionIds.current.add(entry.envelopeId)
          toast.info(`Retracted message in ${entry.conversationId}`)
        }
      } catch (error) {
        reportPollingError(error, t("chat.pollFailed"))
      }
    }

    const startTimers = () => {
      window.clearInterval(activeTimer)
      window.clearInterval(globalTimer)

      // When SSE is active, relax polling intervals (polling is fallback only)
      const activeMs = sseActiveRef.current ? SSE_ACTIVE_INTERVAL_MS : ACTIVE_INTERVAL_MS
      const idleMs = sseActiveRef.current ? SSE_IDLE_INTERVAL_MS : IDLE_INTERVAL_MS

      activeTimer = window.setInterval(() => {
        void pollActiveConversation()
      }, activeMs)

      globalTimer = window.setInterval(() => {
        void pollGlobal()
        void pollRetracted()
      }, idleMs)
    }

    // Expose poll functions for SSE-triggered immediate refetch
    pollActiveRef.current = () => void pollActiveConversation()
    pollGlobalRef.current = () => void pollGlobal()

    const handleVisibility = () => {
      if (document.hidden) {
        setPollingState("paused")
        return
      }
      void pollGlobal()
      void pollActiveConversation()
      void pollRetracted()
      setPollingState(selectedConversationId ? "active" : "idle")
    }

    document.addEventListener("visibilitychange", handleVisibility)
    startTimers()
    void pollGlobal()
    void pollActiveConversation()
    void pollRetracted()

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility)
      window.clearInterval(activeTimer)
      window.clearInterval(globalTimer)
    }
  }, [
    sessionToken,
    markRead,
    refreshConversations,
    mergeConversations,
    mergeGlobalMessages,
    nodeUrl,
    sdk,
    selectedConversationId,
    setPollingState,
    t,
    status,
    upsertMessages,
    markUnreachable,
  ])
}
