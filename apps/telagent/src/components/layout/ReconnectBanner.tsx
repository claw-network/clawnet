import { WifiOffIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useConnectionStore } from "@/stores/connection"

export function ReconnectBanner() {
  const { t } = useTranslation()
  const nodeUrl = useConnectionStore((state) => state.nodeUrl)
  const status = useConnectionStore((state) => state.status)
  const reconnectHintVisible = useConnectionStore((state) => state.reconnectHintVisible)
  const reconnectFromStorage = useConnectionStore((state) => state.reconnectFromStorage)

  if (!nodeUrl || status === "connected" || !reconnectHintVisible) {
    return null
  }

  return (
    <div className="px-3 pt-3">
      <Alert variant="destructive" className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <WifiOffIcon className="mt-0.5 size-4" />
          <div>
            <AlertTitle>{t("status.reconnectTitle")}</AlertTitle>
            <AlertDescription>{t("status.reconnectPrompt")}</AlertDescription>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => void reconnectFromStorage()}>
          {t("status.reconnectNow")}
        </Button>
      </Alert>
    </div>
  )
}
