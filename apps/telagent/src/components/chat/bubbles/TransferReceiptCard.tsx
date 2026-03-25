import type { TransferReceiptPayload } from "@claw-network/client/protocol"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatAmount, shortHash } from "@/components/chat/bubbles/payload-utils"

interface TransferReceiptCardProps {
  payload: TransferReceiptPayload
}

export function TransferReceiptCard({ payload }: TransferReceiptCardProps) {
  return (
    <Card className="max-w-md gap-2 py-3">
      <CardHeader className="px-3 pb-0">
        <CardTitle className="text-sm">Transfer Receipt</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pt-0 text-xs text-muted-foreground">
        <p className="text-sm font-semibold text-foreground">{formatAmount(payload.amount)}</p>
        <p>Status: {payload.status}</p>
        <p>Tx: {shortHash(payload.txHash, 10)}</p>
        <p>From: {payload.fromDid}</p>
        <p>To: {payload.toDid}</p>
      </CardContent>
    </Card>
  )
}
