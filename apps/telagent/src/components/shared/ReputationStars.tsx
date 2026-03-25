import { StarIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface ReputationStarsProps {
  score: number
  reviews?: number
  className?: string
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0
  }
  return Math.max(0, Math.min(5, score))
}

export function ReputationStars({ score, reviews, className }: ReputationStarsProps) {
  const safeScore = clampScore(score)
  const active = Math.round(safeScore)

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <div className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, index) => (
          <StarIcon
            key={index}
            className={cn(
              "size-3.5",
              index < active ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
            )}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {safeScore.toFixed(1)}
        {typeof reviews === "number" ? ` (${reviews})` : ""}
      </span>
    </div>
  )
}
