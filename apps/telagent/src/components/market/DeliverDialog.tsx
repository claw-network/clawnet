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

interface DeliverDialogProps {
  listingId: string
  listingType: "info" | "task"
  onDelivered?: () => Promise<void> | void
}

export function DeliverDialog({ listingId, listingType, onDelivered }: DeliverDialogProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("clawnet_market")
  const { withSession } = useSessionGuard()
  const deliverInfo = useMarketStore((state) => state.deliverInfo)
  const deliverTask = useMarketStore((state) => state.deliverTask)

  const [open, setOpen] = useState(false)
  const [content, setContent] = useState("")
  const [contentType, setContentType] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (!canExecute) return null

  const onSubmit = async () => {
    if (!content.trim()) {
      toast.error(t("market.deliverValidation"))
      return
    }

    setSubmitting(true)
    try {
      await withSession(
        async (sessionToken) => {
          const input = {
            content: content.trim(),
            contentType: contentType.trim() || undefined,
          }
          if (listingType === "info") {
            return deliverInfo(sessionToken, listingId, input)
          }
          return deliverTask(sessionToken, listingId, input)
        },
        { requiredScope: ["market"] },
      )
      toast.success(t("market.deliverSuccess"))
      setOpen(false)
      setContent("")
      setContentType("")
      await onDelivered?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.deliverFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">{t("market.deliver")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("market.deliver")}</DialogTitle>
          <DialogDescription>{t("market.deliverDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="deliver-content">{t("market.deliverContent")}</Label>
            <Textarea id="deliver-content" value={content} onChange={(e) => setContent(e.target.value)} disabled={submitting} className="min-h-[120px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deliver-type">{t("market.deliverContentType")}</Label>
            <Input id="deliver-type" value={contentType} onChange={(e) => setContentType(e.target.value)} placeholder="text/plain" disabled={submitting} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={submitting}>
            {submitting ? t("market.submitting") : t("market.deliver")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
