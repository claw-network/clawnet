import type { TaskBidPayload } from "@claw-network/client/protocol"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatAmount } from "@/components/chat/bubbles/payload-utils"

interface TaskBidCardProps {
  payload: TaskBidPayload
}

export function TaskBidCard({ payload }: TaskBidCardProps) {
  return (
    <Card className="max-w-md gap-2 py-3">
      <CardHeader className="px-3 pb-0">
        <CardTitle className="text-sm">Task Bid</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pt-0 text-xs text-muted-foreground">
        <p>Listing: {payload.listingId}</p>
        <p>Bidder: {payload.bidder}</p>
        <p className="text-sm font-semibold text-foreground">{formatAmount(payload.amount)}</p>
        {payload.proposal ? <p>Proposal: {payload.proposal}</p> : null}
      </CardContent>
    </Card>
  )
}
