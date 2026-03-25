import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useGuardedAction } from "@/hooks/use-guarded-action"
import { useSessionGuard } from "@/hooks/use-session-guard"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useMarketStore } from "@/stores/market"

interface CapabilityActionsProps {
  listingId: string
  status: string
  onAction?: () => Promise<void> | void
}

export function CapabilityActions({ listingId, status, onAction }: CapabilityActionsProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("clawnet_market")
  const { withSession } = useSessionGuard()
  const leaseCapability = useMarketStore((state) => state.leaseCapability)
  const invokeCapability = useMarketStore((state) => state.invokeCapability)
  const pauseLease = useMarketStore((state) => state.pauseLease)
  const resumeLease = useMarketStore((state) => state.resumeLease)
  const terminateLease = useMarketStore((state) => state.terminateLease)

  const [maxInvocations, setMaxInvocations] = useState("")
  const [invokePayload, setInvokePayload] = useState('{\n  \n}')

  if (!canExecute) return null

  const wrap = async (label: string, fn: (token: string) => Promise<unknown>) => {
    try {
      await withSession(fn, { requiredScope: ["market"] })
      toast.success(label)
      await onAction?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : label)
    }
  }

  const onLease = () => {
    const max = Number.parseInt(maxInvocations, 10)
    void wrap(t("market.leaseSuccess"), (tk) =>
      leaseCapability(tk, listingId, {
        maxInvocations: Number.isFinite(max) && max > 0 ? max : undefined,
      }),
    )
  }

  const onInvoke = () => {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(invokePayload) as Record<string, unknown>
    } catch {
      toast.error(t("market.invokePayloadInvalid"))
      return
    }
    void wrap(t("market.invokeSuccess"), (tk) => invokeCapability(tk, listingId, payload))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("market.capabilityActions")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "active" || status === "open" ? (
          <div className="space-y-2">
            <Label>{t("market.maxInvocations")}</Label>
            <div className="flex items-center gap-2">
              <Input type="number" value={maxInvocations} onChange={(e) => setMaxInvocations(e.target.value)} min={1} className="w-32" />
              <Button size="sm" onClick={onLease}>{t("market.lease")}</Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>{t("market.invokePayload")}</Label>
          <Textarea value={invokePayload} onChange={(e) => setInvokePayload(e.target.value)} className="min-h-[80px] font-mono text-xs" />
          <Button size="sm" onClick={onInvoke}>{t("market.invoke")}</Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void wrap(t("market.pauseSuccess"), (tk) => pauseLease(tk, listingId))}>
            {t("market.pause")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void wrap(t("market.resumeSuccess"), (tk) => resumeLease(tk, listingId))}>
            {t("market.resume")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void wrap(t("market.terminateSuccess"), (tk) => terminateLease(tk, listingId))}>
            {t("market.terminate")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
