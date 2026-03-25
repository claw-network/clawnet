import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"

interface LeaseStatusProps {
  status: string
  invocationsUsed?: number
  maxInvocations?: number
}

export function LeaseStatus({ status, invocationsUsed, maxInvocations }: LeaseStatusProps) {
  const { t } = useTranslation()

  const variant = status === "active" ? "default" : status === "paused" ? "secondary" : "outline"

  return (
    <div className="flex items-center gap-3">
      <Badge variant={variant}>{t(`market.status_${status}`, status)}</Badge>
      {typeof invocationsUsed === "number" ? (
        <span className="text-xs text-muted-foreground">
          {t("market.invocations")}: {invocationsUsed}{maxInvocations ? ` / ${maxInvocations}` : ""}
        </span>
      ) : null}
    </div>
  )
}
