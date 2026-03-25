import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useGuardedAction } from "@/hooks/use-guarded-action"
import { useSessionGuard } from "@/hooks/use-session-guard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { DisputeView } from "@/stores/market"
import { useMarketStore } from "@/stores/market"

interface DisputeDetailProps {
  dispute: DisputeView
}

export function DisputeDetail({ dispute }: DisputeDetailProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("clawnet_market")
  const { withSession } = useSessionGuard()
  const respondDispute = useMarketStore((state) => state.respondDispute)
  const refreshDisputes = useMarketStore((state) => state.refreshDisputes)

  const onRespond = async (response: string) => {
    try {
      await withSession(
        async (sessionToken) => respondDispute(sessionToken, dispute.id, { response }),
        { requiredScope: ["market"] },
      )
      toast.success(t("market.disputeResponded"))
      await refreshDisputes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.disputeFailed"))
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t("market.dispute")}</CardTitle>
          <Badge variant={dispute.status === "resolved" ? "secondary" : "destructive"}>
            {dispute.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">{t("market.disputeReason")}</p>
          <p>{dispute.reason}</p>
        </div>
        {dispute.evidence ? (
          <div>
            <p className="text-xs text-muted-foreground">{t("market.disputeEvidence")}</p>
            <p>{dispute.evidence}</p>
          </div>
        ) : null}
        <Separator />
        <p className="text-xs text-muted-foreground">
          {t("market.orderId")}: {dispute.orderId}
        </p>
        {canExecute && dispute.status === "open" ? (
          <Button size="sm" variant="outline" onClick={() => void onRespond("acknowledged")}>
            {t("market.respondDispute")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
