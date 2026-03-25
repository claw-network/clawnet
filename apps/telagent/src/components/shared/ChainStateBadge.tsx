import type { GroupState } from "@claw-network/client/protocol"

import { Badge } from "@/components/ui/badge"

interface ChainStateBadgeProps {
  state: GroupState
}

const CHAIN_STATE_VARIANT: Record<GroupState, "warning" | "success" | "destructive"> = {
  PENDING_ONCHAIN: "warning",
  ACTIVE: "success",
  REORGED_BACK: "destructive",
}

export function ChainStateBadge({ state }: ChainStateBadgeProps) {
  return <Badge variant={CHAIN_STATE_VARIANT[state]}>{state}</Badge>
}
