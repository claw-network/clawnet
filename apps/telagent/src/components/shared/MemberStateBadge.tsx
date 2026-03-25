import type { MembershipState } from "@claw-network/client/protocol"

import { Badge } from "@/components/ui/badge"

interface MemberStateBadgeProps {
  state: MembershipState
}

const MEMBER_STATE_VARIANT: Record<MembershipState, "warning" | "success" | "destructive"> = {
  PENDING: "warning",
  FINALIZED: "success",
  REMOVED: "destructive",
}

export function MemberStateBadge({ state }: MemberStateBadgeProps) {
  return <Badge variant={MEMBER_STATE_VARIANT[state]}>{state}</Badge>
}
