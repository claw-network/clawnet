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

interface PublishTaskDialogProps {
  onPublished?: () => Promise<void> | void
}

export function PublishTaskDialog({ onPublished }: PublishTaskDialogProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("clawnet_market")
  const { withSession } = useSessionGuard()
  const publishTask = useMarketStore((state) => state.publishTask)

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [budget, setBudget] = useState("")
  const [tags, setTags] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (!canExecute) {
    return null
  }

  const onSubmit = async () => {
    const parsedBudget = Number.parseFloat(budget)
    if (!title.trim() || !description.trim() || !Number.isFinite(parsedBudget) || parsedBudget <= 0) {
      toast.error(t("market.publishValidation"))
      return
    }

    setSubmitting(true)
    try {
      await withSession(
        async (sessionToken) =>
          publishTask(sessionToken, {
            title: title.trim(),
            description: description.trim(),
            budget: parsedBudget,
            tags: tags
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          }),
        { requiredScope: ["market"] },
      )
      toast.success(t("market.publishSuccess"))
      setOpen(false)
      setTitle("")
      setDescription("")
      setBudget("")
      setTags("")
      await onPublished?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("market.publishFailed"))
    } finally {
      setSubmitting(false)
    }
  }

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
            <Label htmlFor="task-title">{t("market.taskTitle")}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-description">{t("market.taskDescription")}</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-budget">{t("market.budget")}</Label>
              <Input
                id="task-budget"
                type="number"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                min={0}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-tags">{t("market.tags")}</Label>
              <Input
                id="task-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="design,translation"
                disabled={submitting}
              />
            </div>
          </div>
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
