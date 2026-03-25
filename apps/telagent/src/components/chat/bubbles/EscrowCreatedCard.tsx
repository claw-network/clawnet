import type { EscrowCreatedPayload } from "@claw-network/client/protocol"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatAmount, shortHash } from "@/components/chat/bubbles/payload-utils"

interface EscrowCreatedCardProps {
  payload: EscrowCreatedPayload
}

export function EscrowCreatedCard({ payload }: EscrowCreatedCardProps) {
  return (
    <Card className="max-w-md gap-2 py-3">
      <CardHeader className="px-3 pb-0">
        <CardTitle className="text-sm">Escrow Created</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pt-0 text-xs text-muted-foreground">
        <p>Escrow: {payload.escrowId}</p>
        <p>Creator: {payload.creator}</p>
        <p>Beneficiary: {payload.beneficiary}</p>
        <p className="text-sm font-semibold text-foreground">{formatAmount(payload.amount)}</p>
        <p>Status: {payload.status}</p>
        {payload.txHash ? <p>Tx: {shortHash(payload.txHash, 10)}</p> : null}
      </CardContent>
    </Card>
  )
}
