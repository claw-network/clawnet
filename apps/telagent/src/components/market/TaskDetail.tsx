import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { BidDialog } from "@/components/market/BidDialog"
import { BidList } from "@/components/market/BidList"
import { ReputationStars } from "@/components/shared/ReputationStars"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { useGuardedAction } from "@/hooks/use-guarded-action"
import { useSessionGuard } from "@/hooks/use-session-guard"
import { useMarketStore } from "@/stores/market"

interface TaskDetailProps {
  taskId: string
}

export function TaskDetail({ taskId }: TaskDetailProps) {
  const { t } = useTranslation()
  const refreshListings = useMarketStore((state) => state.refreshListings)
  const loadBids = useMarketStore((state) => state.loadBids)
  const submitReview = useMarketStore((state) => state.submitReview)
  const createServiceContract = useMarketStore((state) => state.createServiceContract)

  const task = useMarketStore((state) => state.getListingById(taskId))
  const { canExecute: canMarketWrite } = useGuardedAction("clawnet_market")
  const { canExecute: canReviewWrite } = useGuardedAction("clawnet_reputation")
  const { withSession } = useSessionGuard()

  const [rating, setRating] = useState(5)
  const [reviewComment, setReviewComment] = useState("")
  const [reviewTargetDid, setReviewTargetDid] = useState("")
  const [contractPayload, setContractPayload] = useState('{\n  "taskId": "",\n  "terms": []\n}')
  const [submittingReview, setSubmittingReview] = useState(false)
  const [submittingContract, setSubmittingContract] = useState(false)

  useEffect(() => {
    void refreshListings()
    void loadBids(taskId)
  }, [loadBids, refreshListings, taskId])

  useEffect(() => {
    if (task?.owner) {
      setReviewTargetDid(task.owner)
    }
  }, [task?.owner])

  const parsedContractPayload = useMemo(() => {
    try {
      const parsed = JSON.parse(contractPayload) as Record<string, unknown>
      return parsed
    } catch {
      return null
    }
  }, [contractPayload])

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
            orderId: taskId,
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

  const onCreateContract = async () => {
    if (!parsedContractPayload) {
      toast.error(t("market.contractValidation"))
      return
    }

    setSubmittingContract(true)
    try {
      await withSession(
        async (sessionToken) => createServiceContract(sessionToken, parsedContractPayload),
        { requiredScope: ["contract"] },
      )
      toast.success(t("market.contractSuccess"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.contractFailed"))
    } finally {
      setSubmittingContract(false)
    }
  }

  if (!task) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("market.taskDetail")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("market.taskNotFound")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>{task.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{task.id}</p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{task.description ?? t("market.noDescription")}</p>
          <Separator />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">{t("market.price")}</p>
              <p>{typeof task.price === "number" ? task.price.toFixed(4) : "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("market.owner")}</p>
              <p>{task.owner ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("market.status")}</p>
              <p>{task.status}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("market.deadline")}</p>
              <p>{task.deadlineMs ? new Date(task.deadlineMs).toLocaleString() : "-"}</p>
            </div>
          </div>

          {canMarketWrite ? (
            <div className="flex flex-wrap gap-2">
              <BidDialog taskId={task.id} onSubmitted={() => loadBids(task.id)} />
              <Button variant="outline" size="sm" onClick={() => void loadBids(task.id)}>
                {t("market.refreshBids")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <BidList taskId={task.id} />

      {canReviewWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("market.submitReview")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="review-target">{t("market.reviewTarget")}</Label>
              <Input
                id="review-target"
                value={reviewTargetDid}
                onChange={(event) => setReviewTargetDid(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("market.rating")}</Label>
              <ReputationStars score={rating} reviews={1} />
              <input
                className="w-full"
                type="range"
                min={1}
                max={5}
                step={1}
                value={rating}
                onChange={(event) => setRating(Number.parseInt(event.target.value, 10))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="review-comment">{t("market.comment")}</Label>
              <Textarea
                id="review-comment"
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
              />
            </div>
            <Button onClick={() => void onSubmitReview()} disabled={submittingReview}>
              {submittingReview ? t("market.submitting") : t("market.submitReview")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canMarketWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("market.createContract")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={contractPayload}
              onChange={(event) => setContractPayload(event.target.value)}
              className="min-h-[160px] font-mono text-xs"
            />
            <Button onClick={() => void onCreateContract()} disabled={submittingContract}>
              {submittingContract ? t("market.submitting") : t("market.createContract")}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
