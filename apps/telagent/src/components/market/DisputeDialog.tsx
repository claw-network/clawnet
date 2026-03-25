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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useMarketStore } from "@/stores/market"

interface DisputeDialogProps {
  orderId: string
  onOpened?: () => Promise<void> | void
}

export function DisputeDialog({ orderId, onOpened }: DisputeDialogProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("clawnet_market")
  const { withSession } = useSessionGuard()
  const openDispute = useMarketStore((state) => state.openDispute)

  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [evidence, setEvidence] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (!canExecute) return null

  const onSubmit = async () => {
    if (!reason.trim()) {
      toast.error(t("market.disputeReasonRequired"))
      return
    }

    setSubmitting(true)
    try {
      await withSession(
        async (sessionToken) =>
          openDispute(sessionToken, {
            orderId,
            reason: reason.trim(),
            evidence: evidence.trim() || undefined,
          }),
        { requiredScope: ["market"] },
      )
      toast.success(t("market.disputeOpened"))
      setOpen(false)
      setReason("")
      setEvidence("")
      await onOpened?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.disputeFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive">{t("market.openDispute")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("market.openDispute")}</DialogTitle>
          <DialogDescription>{t("market.disputeDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="dispute-reason">{t("market.disputeReason")}</Label>
            <Textarea id="dispute-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={submitting} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dispute-evidence">{t("market.disputeEvidence")}</Label>
            <Textarea id="dispute-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} disabled={submitting} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void onSubmit()} disabled={submitting}>
            {submitting ? t("market.submitting") : t("market.openDispute")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
