import type { TaskListingPayload } from "@claw-network/client/protocol"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatAmount } from "@/components/chat/bubbles/payload-utils"

interface TaskListingCardProps {
  payload: TaskListingPayload
}

export function TaskListingCard({ payload }: TaskListingCardProps) {
  return (
    <Card className="max-w-md gap-2 py-3">
      <CardHeader className="px-3 pb-0">
        <CardTitle className="text-sm">Task Listing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pt-0 text-xs text-muted-foreground">
        <p className="text-sm font-semibold text-foreground">{payload.title}</p>
        <p>Listing: {payload.listingId}</p>
        <p>Pricing: {payload.pricing.model} / {formatAmount(payload.pricing.basePrice)}</p>
        {payload.deadline ? <p>Deadline: {new Date(payload.deadline).toLocaleString()}</p> : null}
        {payload.tags && payload.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {payload.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">#{tag}</span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
