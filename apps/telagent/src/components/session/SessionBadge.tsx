import { LockIcon, LockOpenIcon, TimerResetIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useSessionStore } from "@/stores/session"

function formatRemaining(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

export function SessionBadge() {
  const { t } = useTranslation()
  const status = useSessionStore((state) => state.status)
  const token = useSessionStore((state) => state.token)
  const scope = useSessionStore((state) => state.scope)
  const openUnlockDialog = useSessionStore((state) => state.openUnlockDialog)
  const lock = useSessionStore((state) => state.lock)
  const clearIfExpired = useSessionStore((state) => state.clearIfExpired)
  const getRemainingMs = useSessionStore((state) => state.getRemainingMs)

  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      clearIfExpired()
      setTick((value) => value + 1)
    }, 1_000)

    return () => window.clearInterval(timer)
  }, [clearIfExpired])

  const remainingSeconds = useMemo(() => Math.floor(getRemainingMs() / 1000), [getRemainingMs, tick])
  const isUnlocked = status === "unlocked" && Boolean(token)

  if (!isUnlocked) {
    return (
      <Button variant="outline" size="sm" onClick={() => openUnlockDialog()}>
        <LockIcon className="size-4" />
        {t("session.locked")}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="gap-1">
        <LockOpenIcon className="size-3.5" />
        {t("session.unlocked")}
      </Badge>
      <Badge variant="outline" className="gap-1 font-mono text-xs">
        <TimerResetIcon className="size-3" />
        {formatRemaining(remainingSeconds)}
      </Badge>
      <Button variant="ghost" size="sm" onClick={() => void lock()}>
        {t("session.lock")}
      </Button>
      {scope.length > 0 ? (
        <span className="hidden max-w-[200px] truncate text-xs text-muted-foreground md:inline">
          {scope.join(",")}
        </span>
      ) : null}
    </div>
  )
}
