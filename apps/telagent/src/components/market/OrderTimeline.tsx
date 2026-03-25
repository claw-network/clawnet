import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"

interface OrderTimelineProps {
  status: string
  type: "info" | "task" | "capability"
}

const INFO_STEPS = ["pending", "paid", "delivered", "confirmed", "reviewed"]
const TASK_STEPS = ["open", "bidding", "accepted", "delivered", "confirmed", "reviewed"]
const CAPABILITY_STEPS = ["active", "paused", "terminated"]

function getSteps(type: "info" | "task" | "capability"): string[] {
  if (type === "info") return INFO_STEPS
  if (type === "task") return TASK_STEPS
  return CAPABILITY_STEPS
}

export function OrderTimeline({ status, type }: OrderTimelineProps) {
  const { t } = useTranslation()
  const steps = getSteps(type)
  const currentIndex = steps.indexOf(status)

  return (
    <div className="flex flex-wrap items-center gap-1">
      {steps.map((step, index) => {
        const isPast = currentIndex >= 0 && index <= currentIndex
        const isCurrent = step === status
        return (
          <div key={step} className="flex items-center gap-1">
            {index > 0 ? <span className="text-muted-foreground">→</span> : null}
            <Badge variant={isCurrent ? "default" : isPast ? "secondary" : "outline"}>
              {t(`market.status_${step}`, step)}
            </Badge>
          </div>
        )
      })}
    </div>
  )
}
