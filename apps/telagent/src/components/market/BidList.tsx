import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useGuardedAction } from "@/hooks/use-guarded-action"
import { useSessionGuard } from "@/hooks/use-session-guard"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useMarketStore } from "@/stores/market"

interface BidListProps {
  taskId: string
}

export function BidList({ taskId }: BidListProps) {
  const { t } = useTranslation()
  const bids = useMarketStore((state) => state.bidsByTask[taskId] ?? [])
  const loading = useMarketStore((state) => state.loadingBids)
  const loadBids = useMarketStore((state) => state.loadBids)
  const acceptBid = useMarketStore((state) => state.acceptBid)
  const rejectBid = useMarketStore((state) => state.rejectBid)
  const withdrawBid = useMarketStore((state) => state.withdrawBid)

  const { canExecute } = useGuardedAction("clawnet_market")
  const { withSession } = useSessionGuard()

  const onAcceptBid = async (bidId: string) => {
    try {
      await withSession(
        async (sessionToken) => acceptBid(sessionToken, taskId, bidId),
        { requiredScope: ["market"] },
      )
      toast.success(t("market.acceptBidSuccess"))
      await loadBids(taskId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.acceptBidFailed"))
    }
  }

  const onRejectBid = async (bidId: string) => {
    try {
      await withSession(
        async (sessionToken) => rejectBid(sessionToken, taskId, bidId),
        { requiredScope: ["market"] },
      )
      toast.success(t("market.rejectBidSuccess"))
      await loadBids(taskId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.rejectBidFailed"))
    }
  }

  const onWithdrawBid = async (bidId: string) => {
    try {
      await withSession(
        async (sessionToken) => withdrawBid(sessionToken, taskId, bidId),
        { requiredScope: ["market"] },
      )
      toast.success(t("market.withdrawBidSuccess"))
      await loadBids(taskId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.withdrawBidFailed"))
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>{t("market.bids")}</CardTitle>
        <Button variant="outline" size="sm" onClick={() => void loadBids(taskId)} disabled={loading}>
          {t("market.refresh")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {bids.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("market.noBids")}</p>
        ) : (
          bids.map((bid) => (
            <div key={bid.id} className="rounded-md border bg-card/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-xs">{bid.id}</p>
                <span className="text-xs text-muted-foreground">{bid.status}</span>
              </div>
              <Separator className="my-2" />
              <p className="text-sm">{t("market.amount")}: {typeof bid.amount === "number" ? bid.amount.toFixed(4) : "-"}</p>
              <p className="text-xs text-muted-foreground">{t("market.bidder")}: {bid.bidder ?? "-"}</p>
              {bid.proposal ? <p className="mt-1 text-xs text-muted-foreground">{bid.proposal}</p> : null}
              {canExecute ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void onAcceptBid(bid.id)}>
                    {t("market.acceptBid")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void onRejectBid(bid.id)}>
                    {t("market.rejectBid")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void onWithdrawBid(bid.id)}>
                    {t("market.withdrawBid")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
