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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { ListingType } from "@/stores/market"
import { useMarketStore } from "@/stores/market"

interface PublishDialogProps {
  onPublished?: () => Promise<void> | void
}

export function PublishDialog({ onPublished }: PublishDialogProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("clawnet_market")
  const { withSession } = useSessionGuard()
  const publishTask = useMarketStore((state) => state.publishTask)
  const publishInfo = useMarketStore((state) => state.publishInfo)
  const publishCapability = useMarketStore((state) => state.publishCapability)

  const [open, setOpen] = useState(false)
  const [listingType, setListingType] = useState<ListingType>("task")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [price, setPrice] = useState("")
  const [tags, setTags] = useState("")
  const [maxConcurrentLeases, setMaxConcurrentLeases] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (!canExecute) return null

  const reset = () => {
    setTitle("")
    setDescription("")
    setPrice("")
    setTags("")
    setMaxConcurrentLeases("")
  }

  const parsedPrice = Number.parseFloat(price)
  const parsedTags = tags.split(",").map((s) => s.trim()).filter(Boolean)

  const onSubmit = async () => {
    if (!title.trim() || !description.trim() || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      toast.error(t("market.publishValidation"))
      return
    }

    setSubmitting(true)
    try {
      await withSession(
        async (sessionToken) => {
          if (listingType === "task") {
            return publishTask(sessionToken, {
              title: title.trim(),
              description: description.trim(),
              budget: parsedPrice,
              tags: parsedTags.length > 0 ? parsedTags : undefined,
            })
          }
          if (listingType === "info") {
            return publishInfo(sessionToken, {
              title: title.trim(),
              description: description.trim(),
              price: parsedPrice,
              tags: parsedTags.length > 0 ? parsedTags : undefined,
            })
          }
          const maxLeases = Number.parseInt(maxConcurrentLeases, 10)
          return publishCapability(sessionToken, {
            title: title.trim(),
            description: description.trim(),
            pricePerInvocation: parsedPrice,
            maxConcurrentLeases: Number.isFinite(maxLeases) && maxLeases > 0 ? maxLeases : undefined,
            tags: parsedTags.length > 0 ? parsedTags : undefined,
          })
        },
        { requiredScope: ["market"] },
      )
      toast.success(t("market.publishSuccess"))
      setOpen(false)
      reset()
      await onPublished?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.publishFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  const priceLabel =
    listingType === "task" ? t("market.budget") :
    listingType === "capability" ? t("market.pricePerInvocation") :
    t("market.price")

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t("market.publish")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("market.publish")}</DialogTitle>
          <DialogDescription>{t("market.publishDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label>{t("market.listingType")}</Label>
            <Select value={listingType} onValueChange={(v) => setListingType(v as ListingType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">{t("market.type_info")}</SelectItem>
                <SelectItem value="task">{t("market.type_task")}</SelectItem>
                <SelectItem value="capability">{t("market.type_capability")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="publish-title">{t("market.taskTitle")}</Label>
            <Input id="publish-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={submitting} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="publish-description">{t("market.taskDescription")}</Label>
            <Textarea id="publish-description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={submitting} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="publish-price">{priceLabel}</Label>
              <Input id="publish-price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} min={0} disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="publish-tags">{t("market.tags")}</Label>
              <Input id="publish-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="design,translation" disabled={submitting} />
            </div>
          </div>
          {listingType === "capability" ? (
            <div className="space-y-2">
              <Label htmlFor="publish-max-leases">{t("market.maxConcurrentLeases")}</Label>
              <Input id="publish-max-leases" type="number" value={maxConcurrentLeases} onChange={(e) => setMaxConcurrentLeases(e.target.value)} min={1} disabled={submitting} />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={submitting}>
            {submitting ? t("market.submitting") : t("market.publish")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
