import type { ReviewCardPayload } from "@claw-network/client/protocol"

import { ReputationStars } from "@/components/shared/ReputationStars"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { shortHash } from "@/components/chat/bubbles/payload-utils"

interface ReviewCardProps {
  payload: ReviewCardPayload
}

export function ReviewCard({ payload }: ReviewCardProps) {
  return (
    <Card className="max-w-md gap-2 py-3">
      <CardHeader className="px-3 pb-0">
        <CardTitle className="text-sm">Review Card</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pt-0 text-xs text-muted-foreground">
        <p>Target: {payload.targetDid}</p>
        <ReputationStars score={payload.rating} />
        <p>{payload.comment}</p>
        <p>Tx: {shortHash(payload.txHash, 10)}</p>
      </CardContent>
    </Card>
  )
}
