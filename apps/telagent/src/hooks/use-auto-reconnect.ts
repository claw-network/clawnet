import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useConnectionStore } from "@/stores/connection"

const RECONNECT_INTERVAL_MS = 5_000
const RECONNECT_TOAST_ID = "connection-reconnect"

export function useAutoReconnect() {
  const { t } = useTranslation()
  const nodeUrl = useConnectionStore((state) => state.nodeUrl)
  const status = useConnectionStore((state) => state.status)
  const reconnectHintVisible = useConnectionStore((state) => state.reconnectHintVisible)
  const reconnectFromStorage = useConnectionStore((state) => state.reconnectFromStorage)
  const setReconnectHintVisible = useConnectionStore((state) => state.setReconnectHintVisible)

  const inFlight = useRef(false)

  useEffect(() => {
    if (!nodeUrl) {
      toast.dismiss(RECONNECT_TOAST_ID)
      return undefined
    }

    if (status === "connected") {
      setReconnectHintVisible(false)
      toast.dismiss(RECONNECT_TOAST_ID)
      return undefined
    }

    if (!reconnectHintVisible) {
      return undefined
    }

    toast.warning(t("status.reconnectPrompt"), {
      id: RECONNECT_TOAST_ID,
      duration: Infinity,
      action: {
        label: t("status.reconnectNow"),
        onClick: () => {
          void reconnectFromStorage()
        },
      },
    })

    const timer = window.setInterval(() => {
      if (inFlight.current) {
        return
      }
      inFlight.current = true
      void reconnectFromStorage().finally(() => {
        inFlight.current = false
      })
    }, RECONNECT_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [nodeUrl, reconnectFromStorage, reconnectHintVisible, setReconnectHintVisible, status, t])
}
