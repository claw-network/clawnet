import type { MilestoneUpdatePayload } from "@claw-network/client/protocol"

import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface MilestoneUpdateCardProps {
  payload: MilestoneUpdatePayload
}

function progressFromStatus(status: MilestoneUpdatePayload["status"]): number {
  if (status === "completed") {
    return 100
  }
  if (status === "in-progress") {
    return 60
  }
  if (status === "disputed") {
    return 40
  }
  return 15
}

export function MilestoneUpdateCard({ payload }: MilestoneUpdateCardProps) {
  const progress = progressFromStatus(payload.status)

  return (
    <Card className="max-w-md gap-2 py-3">
      <CardHeader className="px-3 pb-0">
        <CardTitle className="text-sm">Milestone Update</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pt-0 text-xs text-muted-foreground">
        <p className="text-sm font-semibold text-foreground">{payload.title}</p>
        <p>Contract: {payload.contractId}</p>
        <p>Milestone #{payload.milestoneIndex}</p>
        <Progress value={progress} />
        <p>Status: {payload.status}</p>
        <p>Updated: {new Date(payload.updatedAt).toLocaleString()}</p>
      </CardContent>
    </Card>
  )
}
