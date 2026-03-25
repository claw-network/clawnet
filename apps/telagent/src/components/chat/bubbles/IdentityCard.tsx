import type { IdentityCardPayload } from "@claw-network/client/protocol"

import { DidAvatar } from "@/components/shared/DidAvatar"
import { ReputationStars } from "@/components/shared/ReputationStars"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface IdentityCardProps {
  payload: IdentityCardPayload
}

export function IdentityCard({ payload }: IdentityCardProps) {
  return (
    <Card className="max-w-md gap-2 py-3">
      <CardHeader className="flex flex-row items-center gap-3 px-3 pb-0">
        <DidAvatar did={payload.did} />
        <div>
          <CardTitle className="text-sm">Identity Card</CardTitle>
          <p className="text-xs text-muted-foreground">{payload.did}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pt-0">
        <p className="text-xs text-muted-foreground">Public key: {payload.publicKey.slice(0, 20)}...</p>
        <ReputationStars score={payload.reputation.score} reviews={payload.reputation.reviews} />
        <div className="flex flex-wrap gap-1">
          {payload.capabilities.map((capability) => (
            <span key={capability} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {capability}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
