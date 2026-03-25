import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { formatApiError, parseApiError } from "@/lib/api-error"
import { useConnectionStore } from "@/stores/connection"

const DEDUPE_WINDOW_MS = 4_000

export function useGlobalErrorToast() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const disconnect = useConnectionStore((state) => state.disconnect)
  const latestKeyRef = useRef<string>("")
  const latestAtRef = useRef<number>(0)
  const navigateRef = useRef(navigate)
  const disconnectRef = useRef(disconnect)

  useEffect(() => { navigateRef.current = navigate }, [navigate])
  useEffect(() => { disconnectRef.current = disconnect }, [disconnect])

  useEffect(() => {
    const emit = (error: unknown) => {
      const parsed = parseApiError(error, t("common.requestFailed"))

      if (parsed.code === "UNAUTHORIZED") {
        disconnectRef.current()
        navigateRef.current("/connect", { replace: true })
        return
      }

      const message = formatApiError(error, t("common.requestFailed"))
      const now = Date.now()
      if (latestKeyRef.current === message && now - latestAtRef.current < DEDUPE_WINDOW_MS) {
        return
      }
      latestKeyRef.current = message
      latestAtRef.current = now
      toast.error(message)
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      emit(event.reason)
    }

    const onError = (event: ErrorEvent) => {
      emit(event.error ?? event.message)
    }

    window.addEventListener("unhandledrejection", onUnhandledRejection)
    window.addEventListener("error", onError)

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
      window.removeEventListener("error", onError)
    }
  }, [t])
}
