import { useEffect, useRef, useCallback } from "react"

import type { EventNotification } from "@claw-network/client/protocol"
import { useConnectionStore } from "@/stores/connection"

/**
 * useEventSource establishes an SSE connection to the node for real-time event push.
 *
 * - Local mode:  connects to `${nodeUrl}/api/v1/events`
 * - DID relay mode: connects to `${gatewayUrl}/relay/${targetDid}/api/v1/events`
 *
 * Returns the latest event and an `isConnected` flag.
 * Automatically reconnects on disconnect. Falls back silently if SSE is unavailable.
 */
export function useEventSource(
  onEvent: (event: EventNotification) => void,
): { isConnected: boolean } {
  const nodeUrl = useConnectionStore((state) => state.nodeUrl)
  const sessionToken = useConnectionStore((state) => state.sessionToken)
  const status = useConnectionStore((state) => state.status)
  const connectionMode = useConnectionStore((state) => state.connectionMode)
  const targetDid = useConnectionStore((state) => state.targetDid)
  const gatewayUrl = useConnectionStore((state) => state.gatewayUrl)

  const isConnectedRef = useRef(false)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  // Build the SSE URL
  const buildSseUrl = useCallback((): string | null => {
    if (!nodeUrl || status !== "connected") {
      console.debug("[sse] buildSseUrl → null (nodeUrl=%s, status=%s)", nodeUrl, status)
      return null
    }

    if (connectionMode === "relay" && targetDid && gatewayUrl) {
      // DID relay mode: SSE through gateway
      const url = `${gatewayUrl.replace(/\/$/, "")}/relay/${encodeURIComponent(targetDid)}/api/v1/events`
      console.debug("[sse] buildSseUrl → %s (relay mode)", url)
      return url
    }

    // Local mode: direct SSE to node
    const url = `${nodeUrl.replace(/\/$/, "")}/api/v1/events`
    console.debug("[sse] buildSseUrl → %s (direct mode)", url)
    return url
  }, [nodeUrl, status, connectionMode, targetDid, gatewayUrl])

  useEffect(() => {
    const url = buildSseUrl()
    if (!url) {
      isConnectedRef.current = false
      return
    }

    // EventSource doesn't support custom headers, but the /events endpoint
    // is auth-whitelisted on the node side. For DID relay mode, auth is
    // handled within the API proxy on the target node.
    let es: EventSource | null = null
    let reconnectTimer: number | undefined

    const connect = () => {
      console.info("[sse] Connecting to %s", url)
      es = new EventSource(url)

      es.onopen = () => {
        console.info("[sse] Connected ✓")
        isConnectedRef.current = true
      }

      // Listen for specific event types
      const eventTypes = [
        "new-envelope",
        "receipt",
        "retraction",
        "conversation-update",
        "profile-update",
      ]

      for (const eventType of eventTypes) {
        es.addEventListener(eventType, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as EventNotification
            onEventRef.current(data)
          } catch {
            // Ignore malformed events
          }
        })
      }

      es.onerror = () => {
        console.warn("[sse] Connection error, reconnecting in 5s…")
        isConnectedRef.current = false
        es?.close()
        es = null
        // Reconnect after 5 seconds
        reconnectTimer = window.setTimeout(connect, 5_000)
      }
    }

    connect()

    return () => {
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      es?.close()
      es = null
      isConnectedRef.current = false
    }
  }, [buildSseUrl, sessionToken])

  return { isConnected: isConnectedRef.current }
}
