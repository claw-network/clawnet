import type { TransferRequestPayload } from "@claw-network/client/protocol"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatAmount } from "@/components/chat/bubbles/payload-utils"

interface TransferRequestCardProps {
  payload: TransferRequestPayload
}

export function TransferRequestCard({ payload }: TransferRequestCardProps) {
  return (
    <Card className="max-w-md gap-2 py-3">
      <CardHeader className="px-3 pb-0">
        <CardTitle className="text-sm">Transfer Request</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pt-0 text-xs text-muted-foreground">
        <p>From: {payload.fromDid}</p>
        <p>To: {payload.toDid}</p>
        <p className="text-sm font-semibold text-foreground">{formatAmount(payload.amount, payload.currency)}</p>
        {payload.memo ? <p>Memo: {payload.memo}</p> : null}
        <p>Request: {payload.requestId}</p>
      </CardContent>
    </Card>
  )
}
