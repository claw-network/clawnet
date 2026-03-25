import type { SessionOperationScope } from "@/lib/telagent-client"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSessionStore } from "@/stores/session"

const VALID_SCOPES: SessionOperationScope[] = ["transfer", "escrow", "market", "contract", "reputation", "identity"]

function parseScopes(raw: string): SessionOperationScope[] {
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

  const deduped = new Set<SessionOperationScope>()
  for (const value of values) {
    if (VALID_SCOPES.includes(value as SessionOperationScope)) {
      deduped.add(value as SessionOperationScope)
    }
  }

  return [...deduped]
}

export function UnlockDialog() {
  const { t } = useTranslation()
  const open = useSessionStore((state) => state.unlockDialogOpen)
  const requestedScope = useSessionStore((state) => state.requestedScope)
  const status = useSessionStore((state) => state.status)
  const error = useSessionStore((state) => state.error)
  const unlock = useSessionStore((state) => state.unlock)
  const cancelUnlockRequest = useSessionStore((state) => state.cancelUnlockRequest)

  const [passphrase, setPassphrase] = useState("")
  const [ttlSeconds, setTtlSeconds] = useState("3600")
  const [maxOperations, setMaxOperations] = useState("100")
  const [scopeText, setScopeText] = useState("")

  useEffect(() => {
    if (!open) {
      return
    }
    setPassphrase("")
    setTtlSeconds("3600")
    setMaxOperations("100")
    setScopeText(requestedScope.join(","))
  }, [open, requestedScope])

  const requiredScopeText = useMemo(
    () => (requestedScope.length ? requestedScope.join(", ") : t("session.anyScope")),
    [requestedScope, t],
  )

  const submitting = status === "unlocking"

  const onSubmit = async () => {
    if (!passphrase.trim()) {
      return
    }

    const parsedScope = parseScopes(scopeText)
    const ttl = Number.parseInt(ttlSeconds, 10)
    const maxOps = Number.parseInt(maxOperations, 10)

    await unlock({
      passphrase,
      ttlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : undefined,
      maxOperations: Number.isFinite(maxOps) && maxOps > 0 ? maxOps : undefined,
      scope: parsedScope.length > 0 ? parsedScope : requestedScope,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next) {
        cancelUnlockRequest()
      }
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("session.unlockTitle")}</DialogTitle>
          <DialogDescription>{t("session.unlockDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="session-passphrase">{t("session.passphrase")}</Label>
            <Input
              id="session-passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="********"
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="session-ttl">{t("session.ttl")}</Label>
              <Input
                id="session-ttl"
                type="number"
                min={60}
                value={ttlSeconds}
                onChange={(event) => setTtlSeconds(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-max-ops">{t("session.maxOperations")}</Label>
              <Input
                id="session-max-ops"
                type="number"
                min={1}
                value={maxOperations}
                onChange={(event) => setMaxOperations(event.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="session-scope">{t("session.scope")}</Label>
            <Input
              id="session-scope"
              value={scopeText}
              onChange={(event) => setScopeText(event.target.value)}
              placeholder="transfer,market"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              {t("session.requiredScope")}: {requiredScopeText}
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => cancelUnlockRequest()} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={submitting || !passphrase.trim()}>
            {submitting ? t("session.unlocking") : t("session.unlock")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
