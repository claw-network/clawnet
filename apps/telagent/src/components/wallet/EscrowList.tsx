import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { useGuardedAction } from "@/hooks/use-guarded-action"
import { useSessionGuard } from "@/hooks/use-session-guard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { useWalletStore } from "@/stores/wallet"

interface EscrowListProps {
  activeEscrowId?: string
}

function formatAmount(amount?: number): string {
  if (typeof amount !== "number") {
    return "-"
  }
  return amount.toFixed(4)
}

export function EscrowList({ activeEscrowId }: EscrowListProps) {
  const { t } = useTranslation()
  const escrows = useWalletStore((state) => state.escrows)
  const loading = useWalletStore((state) => state.loadingEscrows)
  const createEscrow = useWalletStore((state) => state.createEscrow)
  const releaseEscrow = useWalletStore((state) => state.releaseEscrow)
  const refreshEscrows = useWalletStore((state) => state.refreshEscrows)

  const { canExecute } = useGuardedAction("clawnet_escrow")
  const { withSession } = useSessionGuard()

  const [createOpen, setCreateOpen] = useState(false)
  const [beneficiary, setBeneficiary] = useState("")
  const [amount, setAmount] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const onCreateEscrow = async () => {
    const parsedAmount = Number.parseFloat(amount)
    if (!beneficiary.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error(t("wallet.escrowValidation"))
      return
    }

    setSubmitting(true)
    try {
      await withSession(
        async (sessionToken) =>
          createEscrow(sessionToken, {
            beneficiary: beneficiary.trim(),
            amount: parsedAmount,
          }),
        { requiredScope: ["escrow"] },
      )
      toast.success(t("wallet.escrowCreated"))
      setCreateOpen(false)
      setBeneficiary("")
      setAmount("")
      await refreshEscrows()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("wallet.escrowCreateFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  const onReleaseEscrow = async (escrowId: string) => {
    setSubmitting(true)
    try {
      await withSession(
        async (sessionToken) => releaseEscrow(sessionToken, escrowId),
        { requiredScope: ["escrow"] },
      )
      toast.success(t("wallet.escrowReleased"))
      await refreshEscrows()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("wallet.escrowReleaseFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>{t("wallet.escrow")}</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refreshEscrows()} disabled={loading || submitting}>
            {t("wallet.refresh")}
          </Button>
          {canExecute ? (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <PlusIcon className="size-4" />
                  {t("wallet.createEscrow")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("wallet.createEscrow")}</DialogTitle>
                  <DialogDescription>{t("wallet.createEscrowDescription")}</DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="escrow-beneficiary">{t("wallet.beneficiary")}</Label>
                    <Input
                      id="escrow-beneficiary"
                      value={beneficiary}
                      onChange={(event) => setBeneficiary(event.target.value)}
                      placeholder="did:claw:..."
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="escrow-amount">{t("wallet.amount")}</Label>
                    <Input
                      id="escrow-amount"
                      type="number"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      min={0}
                      disabled={submitting}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
                    {t("common.cancel")}
                  </Button>
                  <Button onClick={() => void onCreateEscrow()} disabled={submitting}>
                    {submitting ? t("wallet.submitting") : t("wallet.createEscrow")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {escrows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("wallet.noEscrow")}</p>
        ) : (
          escrows.map((escrow) => {
            const active = activeEscrowId === escrow.id
            const releasable = escrow.status.toLowerCase() !== "released"

            return (
              <div
                key={escrow.id}
                className={`rounded-md border p-3 ${active ? "border-primary bg-primary/5" : "bg-card/40"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/wallet/escrow/${encodeURIComponent(escrow.id)}`} className="font-mono text-xs text-primary hover:underline">
                    {escrow.id}
                  </Link>
                  <Badge variant="outline">{escrow.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("wallet.amount")}: {formatAmount(escrow.amount)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("wallet.beneficiary")}: {escrow.beneficiary ?? "-"}
                </p>
                {canExecute && releasable ? (
                  <div className="mt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={submitting}
                      onClick={() => void onReleaseEscrow(escrow.id)}
                    >
                      {t("wallet.releaseEscrow")}
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
