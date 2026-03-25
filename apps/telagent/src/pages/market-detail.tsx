import { ArrowLeftIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import { BidDialog } from "@/components/market/BidDialog"
import { BidList } from "@/components/market/BidList"
import { CapabilityActions } from "@/components/market/CapabilityActions"
import { DeliverDialog } from "@/components/market/DeliverDialog"
import { DisputeDialog } from "@/components/market/DisputeDialog"
import { InfoActions } from "@/components/market/InfoActions"
import { ListingList } from "@/components/market/ListingList"
import { OrderTimeline } from "@/components/market/OrderTimeline"
import { ReputationStars } from "@/components/shared/ReputationStars"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { useGuardedAction } from "@/hooks/use-guarded-action"
import { useSessionGuard } from "@/hooks/use-session-guard"
import type { ListingType } from "@/stores/market"
import { useMarketStore } from "@/stores/market"

export function MarketDetailPage() {
  const { t } = useTranslation()
  const { type = "task", id = "" } = useParams<{ type: string; id: string }>()
  const listingType = type as ListingType

  const refreshListings = useMarketStore((state) => state.refreshListings)
  const loadBids = useMarketStore((state) => state.loadBids)
  const listing = useMarketStore((state) => state.getListingById(id))
  const submitReview = useMarketStore((state) => state.submitReview)
  const confirmTask = useMarketStore((state) => state.confirmTask)

  const { canExecute: canMarketWrite } = useGuardedAction("clawnet_market")
  const { canExecute: canReviewWrite } = useGuardedAction("clawnet_reputation")
  const { withSession } = useSessionGuard()

  const [rating, setRating] = useState(5)
  const [reviewComment, setReviewComment] = useState("")
  const [reviewTargetDid, setReviewTargetDid] = useState("")
  const [submittingReview, setSubmittingReview] = useState(false)

  useEffect(() => {
    void refreshListings()
    if (listingType === "task" && id) {
      void loadBids(id)
    }
  }, [loadBids, refreshListings, listingType, id])

  useEffect(() => {
    if (listing?.owner) {
      setReviewTargetDid(listing.owner)
    }
  }, [listing?.owner])

  const onSubmitReview = async () => {
    if (!reviewTargetDid.trim()) {
      toast.error(t("market.reviewValidation"))
      return
    }

    setSubmittingReview(true)
    try {
      await withSession(
        async (sessionToken) =>
          submitReview(sessionToken, {
            targetDid: reviewTargetDid.trim(),
            score: rating,
            comment: reviewComment.trim() || undefined,
            orderId: id,
          }),
        { requiredScope: ["reputation"] },
      )
      toast.success(t("market.reviewSuccess"))
      setReviewComment("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.reviewFailed"))
    } finally {
      setSubmittingReview(false)
    }
  }

  const onConfirmTask = async () => {
    try {
      await withSession(
        async (sessionToken) => confirmTask(sessionToken, id),
        { requiredScope: ["market"] },
      )
      toast.success(t("market.confirmSuccess"))
      await refreshListings()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.confirmFailed"))
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-auto p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/market">
            <ArrowLeftIcon className="size-4" />
            {t("market.backToMarket")}
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <ListingList activeListingId={id} />

        {listing ? (
          <div className="space-y-4">
            <Card>
              <CardHeader className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge>{t(`market.type_${listing.type}`)}</Badge>
                  <CardTitle>{listing.title}</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">{listing.id}</p>
                <OrderTimeline status={listing.status} type={listing.type} />
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{listing.description ?? t("market.noDescription")}</p>
                <Separator />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("market.price")}</p>
                    <p>{typeof listing.price === "number" ? listing.price.toFixed(4) : "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("market.owner")}</p>
                    <p>{listing.owner ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("market.status")}</p>
                    <p>{listing.status}</p>
                  </div>
                  {listing.deadlineMs ? (
                    <div>
                      <p className="text-xs text-muted-foreground">{t("market.deadline")}</p>
                      <p>{new Date(listing.deadlineMs).toLocaleString()}</p>
                    </div>
                  ) : null}
                </div>
                {listing.tags?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {listing.tags.map((tag) => (
                      <Badge key={tag} variant="outline">{tag}</Badge>
                    ))}
                  </div>
                ) : null}

                {/* Type-specific actions */}
                {listing.type === "info" && canMarketWrite ? (
                  <>
                    <Separator />
                    <InfoActions listingId={listing.id} status={listing.status} onAction={() => refreshListings()} />
                    <DeliverDialog listingId={listing.id} listingType="info" onDelivered={() => refreshListings()} />
                  </>
                ) : null}

                {listing.type === "task" && canMarketWrite ? (
                  <>
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      <BidDialog taskId={listing.id} onSubmitted={() => loadBids(listing.id)} />
                      <DeliverDialog listingId={listing.id} listingType="task" onDelivered={() => refreshListings()} />
                      {listing.status === "delivered" ? (
                        <Button size="sm" onClick={() => void onConfirmTask()}>
                          {t("market.confirm")}
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" onClick={() => void loadBids(listing.id)}>
                        {t("market.refreshBids")}
                      </Button>
                    </div>
                  </>
                ) : null}

                {/* Dispute button for any type */}
                {canMarketWrite && (listing.status === "delivered" || listing.status === "confirmed" || listing.status === "paid") ? (
                  <DisputeDialog orderId={listing.id} onOpened={() => refreshListings()} />
                ) : null}
              </CardContent>
            </Card>

            {/* Task-specific: bid list */}
            {listing.type === "task" ? <BidList taskId={listing.id} /> : null}

            {/* Capability-specific: actions panel */}
            {listing.type === "capability" ? (
              <CapabilityActions listingId={listing.id} status={listing.status} onAction={() => refreshListings()} />
            ) : null}

            {/* Review section */}
            {canReviewWrite ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t("market.submitReview")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="review-target">{t("market.reviewTarget")}</Label>
                    <Input id="review-target" value={reviewTargetDid} onChange={(e) => setReviewTargetDid(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("market.rating")}</Label>
                    <ReputationStars score={rating} reviews={1} />
                    <input className="w-full" type="range" min={1} max={5} step={1} value={rating} onChange={(e) => setRating(Number.parseInt(e.target.value, 10))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="review-comment">{t("market.comment")}</Label>
                    <Textarea id="review-comment" value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} />
                  </div>
                  <Button onClick={() => void onSubmitReview()} disabled={submittingReview}>
                    {submittingReview ? t("market.submitting") : t("market.submitReview")}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t("market.listingDetail")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t("market.listingNotFound")}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
