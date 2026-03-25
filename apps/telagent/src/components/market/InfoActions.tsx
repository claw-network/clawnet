import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useGuardedAction } from "@/hooks/use-guarded-action"
import { useSessionGuard } from "@/hooks/use-session-guard"
import { Button } from "@/components/ui/button"
import { useMarketStore } from "@/stores/market"

interface InfoActionsProps {
  listingId: string
  status: string
  onAction?: () => Promise<void> | void
}

export function InfoActions({ listingId, status, onAction }: InfoActionsProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("clawnet_market")
  const { withSession } = useSessionGuard()
  const purchaseInfo = useMarketStore((state) => state.purchaseInfo)
  const confirmInfo = useMarketStore((state) => state.confirmInfo)
  const subscribeInfo = useMarketStore((state) => state.subscribeInfo)
  const unsubscribeInfo = useMarketStore((state) => state.unsubscribeInfo)

  if (!canExecute) return null

  const wrap = async (label: string, fn: (token: string) => Promise<unknown>) => {
    try {
      await withSession(fn, { requiredScope: ["market"] })
      toast.success(label)
      await onAction?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : label)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "pending" || status === "open" ? (
        <Button size="sm" onClick={() => void wrap(t("market.purchaseSuccess"), (tk) => purchaseInfo(tk, listingId))}>
          {t("market.purchase")}
        </Button>
      ) : null}
      {status === "delivered" ? (
        <Button size="sm" onClick={() => void wrap(t("market.confirmSuccess"), (tk) => confirmInfo(tk, listingId))}>
          {t("market.confirm")}
        </Button>
      ) : null}
      <Button size="sm" variant="outline" onClick={() => void wrap(t("market.subscribeSuccess"), (tk) => subscribeInfo(tk, listingId))}>
        {t("market.subscribe")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void wrap(t("market.unsubscribeSuccess"), (tk) => unsubscribeInfo(tk, listingId))}>
        {t("market.unsubscribe")}
      </Button>
    </div>
  )
}
