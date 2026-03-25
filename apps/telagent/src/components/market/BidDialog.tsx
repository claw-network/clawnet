import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useGuardedAction } from "@/hooks/use-guarded-action"
import { useSessionGuard } from "@/hooks/use-session-guard"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useMarketStore } from "@/stores/market"

interface BidDialogProps {
  taskId: string
  onSubmitted?: () => Promise<void> | void
}

export function BidDialog({ taskId, onSubmitted }: BidDialogProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("clawnet_market")
  const { withSession } = useSessionGuard()
  const submitBid = useMarketStore((state) => state.bid)

  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [proposal, setProposal] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (!canExecute) {
    return null
  }

  const onSubmit = async () => {
    const parsedAmount = Number.parseFloat(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error(t("market.bidValidation"))
      return
    }

    setSubmitting(true)
    try {
      await withSession(
        async (sessionToken) =>
          submitBid(sessionToken, taskId, {
            amount: parsedAmount,
            proposal: proposal.trim() || undefined,
          }),
        { requiredScope: ["market"] },
      )
      toast.success(t("market.bidSuccess"))
      setOpen(false)
      setAmount("")
      setProposal("")
      await onSubmitted?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.bidFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">{t("market.bid")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("market.bid")}</DialogTitle>
          <DialogDescription>{t("market.bidDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="bid-amount">{t("market.amount")}</Label>
            <Input
              id="bid-amount"
              type="number"
              value={amount}
              min={0}
              onChange={(event) => setAmount(event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bid-proposal">{t("market.proposal")}</Label>
            <Textarea
              id="bid-proposal"
              value={proposal}
              onChange={(event) => setProposal(event.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={submitting}>
            {submitting ? t("market.submitting") : t("market.bid")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
