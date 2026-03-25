import type { EscrowReleasedPayload } from "@claw-network/client/protocol"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatAmount, shortHash } from "@/components/chat/bubbles/payload-utils"

interface EscrowReleasedCardProps {
  payload: EscrowReleasedPayload
}

export function EscrowReleasedCard({ payload }: EscrowReleasedCardProps) {
  return (
    <Card className="max-w-md gap-2 py-3">
      <CardHeader className="px-3 pb-0">
        <CardTitle className="text-sm">Escrow Released</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pt-0 text-xs text-muted-foreground">
        <p>Escrow: {payload.escrowId}</p>
        <p>Beneficiary: {payload.beneficiary}</p>
        <p className="text-sm font-semibold text-foreground">{formatAmount(payload.amount)}</p>
        <p>Status: {payload.status}</p>
        {payload.txHash ? <p>Tx: {shortHash(payload.txHash, 10)}</p> : null}
      </CardContent>
    </Card>
  )
}
