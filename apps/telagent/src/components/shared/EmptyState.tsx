import type { LucideIcon } from "lucide-react"
import { InboxIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

interface EmptyStateProps {
  title: string
  description?: string
  icon?: LucideIcon
  actionLabel?: string
  onAction?: () => void
  className?: string
  children?: ReactNode
}

export function EmptyState({
  title,
  description,
  icon: Icon = InboxIcon,
  actionLabel,
  onAction,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 px-4 py-10 text-center ${className ?? ""}`}>
      <div className="rounded-full border bg-muted/40 p-3">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-xs text-muted-foreground">{description}</p> : null}
      {actionLabel && onAction ? (
        <Button size="sm" variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
      {children}
    </div>
  )
}
