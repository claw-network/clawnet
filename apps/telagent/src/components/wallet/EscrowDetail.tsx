import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useGuardedAction } from "@/hooks/use-guarded-action"
import { useSessionGuard } from "@/hooks/use-session-guard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useWalletStore } from "@/stores/wallet"

interface EscrowDetailProps {
  escrowId: string
}

function asJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return "{}"
  }
}

export function EscrowDetail({ escrowId }: EscrowDetailProps) {
  const { t } = useTranslation()
  const loadEscrow = useWalletStore((state) => state.loadEscrow)
  const escrows = useWalletStore((state) => state.escrows)
  const releaseEscrow = useWalletStore((state) => state.releaseEscrow)

  const { canExecute } = useGuardedAction("clawnet_escrow")
  const { withSession } = useSessionGuard()

  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void loadEscrow(escrowId)
  }, [escrowId, loadEscrow])

  const escrow = useMemo(
    () => escrows.find((item) => item.id === escrowId) ?? null,
    [escrowId, escrows],
  )

  const onRelease = async () => {
    if (!escrow) {
      return
    }

    setLoading(true)
    try {
      await withSession(
        async (sessionToken) => releaseEscrow(sessionToken, escrow.id),
        { requiredScope: ["escrow"] },
      )
      await loadEscrow(escrow.id)
      toast.success(t("wallet.escrowReleased"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("wallet.escrowReleaseFailed"))
    } finally {
      setLoading(false)
    }
  }

  if (!escrow) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("wallet.escrowDetail")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("wallet.escrowNotFound")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>{t("wallet.escrowDetail")}</CardTitle>
        <Badge variant="outline">{escrow.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">{t("wallet.escrowId")}</p>
          <p className="font-mono text-xs">{escrow.id}</p>
        </div>
        <Separator />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">{t("wallet.creator")}</p>
            <p>{escrow.creator ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("wallet.beneficiary")}</p>
            <p>{escrow.beneficiary ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("wallet.amount")}</p>
            <p>{typeof escrow.amount === "number" ? escrow.amount.toFixed(4) : "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("wallet.updatedAt")}</p>
            <p>{escrow.updatedAtMs ? new Date(escrow.updatedAtMs).toLocaleString() : "-"}</p>
          </div>
        </div>

        {canExecute && escrow.status.toLowerCase() !== "released" ? (
          <Button onClick={() => void onRelease()} disabled={loading}>
            {loading ? t("wallet.submitting") : t("wallet.releaseEscrow")}
          </Button>
        ) : null}

        <div>
          <p className="mb-1 text-xs text-muted-foreground">{t("wallet.rawPayload")}</p>
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">{asJson(escrow.raw)}</pre>
        </div>
      </CardContent>
    </Card>
  )
}
