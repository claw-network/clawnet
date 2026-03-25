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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useWalletStore } from "@/stores/wallet"

interface TransferDialogProps {
  onTransferred?: () => Promise<void> | void
}

export function TransferDialog({ onTransferred }: TransferDialogProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("clawnet_transfer")
  const { withSession } = useSessionGuard()
  const transfer = useWalletStore((state) => state.transfer)

  const [open, setOpen] = useState(false)
  const [toDid, setToDid] = useState("")
  const [amount, setAmount] = useState("")
  const [memo, setMemo] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (!canExecute) {
    return null
  }

  const onSubmit = async () => {
    const parsedAmount = Number.parseFloat(amount)
    if (!toDid.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error(t("wallet.transferValidation"))
      return
    }

    setSubmitting(true)
    try {
      await withSession(
        async (sessionToken) => {
          return transfer(sessionToken, {
            to: toDid.trim(),
            amount: parsedAmount,
            memo: memo.trim() || undefined,
          })
        },
        { requiredScope: ["transfer"] },
      )

      toast.success(t("wallet.transferSuccess"))
      setOpen(false)
      setToDid("")
      setAmount("")
      setMemo("")
      await onTransferred?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("wallet.transferFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t("wallet.transfer")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("wallet.transfer")}</DialogTitle>
          <DialogDescription>{t("wallet.transferDescription")}</DialogDescription>
        </DialogHeader>

        <FieldGroup className="py-2">
          <Field>
            <FieldLabel htmlFor="transfer-to">{t("wallet.toDid")}</FieldLabel>
            <Input
              id="transfer-to"
              value={toDid}
              onChange={(event) => setToDid(event.target.value)}
              placeholder="did:claw:..."
              disabled={submitting}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="transfer-amount">{t("wallet.amount")}</FieldLabel>
            <Input
              id="transfer-amount"
              type="number"
              min={0}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="transfer-memo">{t("wallet.memo")}</FieldLabel>
            <Input
              id="transfer-memo"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              disabled={submitting}
            />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={submitting}>
            {submitting ? t("wallet.submitting") : t("wallet.transfer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
