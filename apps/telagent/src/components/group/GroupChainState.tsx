import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { ChainStateBadge } from "@/components/shared/ChainStateBadge"
import { Card } from "@/components/ui/card"
import { useGroupStore } from "@/stores/group"

interface GroupChainStateProps {
  groupId: string
}

function shortenHash(value?: string): string {
  if (!value) {
    return "-"
  }
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

export function GroupChainState({ groupId }: GroupChainStateProps) {
  const { t } = useTranslation()
  const ensureChainState = useGroupStore((state) => state.ensureChainState)
  const chainState = useGroupStore((state) => state.chainStateByGroupId[groupId])

  useEffect(() => {
    void ensureChainState(groupId)
  }, [ensureChainState, groupId])

  return (
    <Card className="space-y-3 p-3">
      <h3 className="text-sm font-medium">{t("details.chainStateTitle")}</h3>
      {chainState ? (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("details.state")}</span>
            <ChainStateBadge state={chainState.state} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("details.txHash")}</span>
            <span className="font-mono">{shortenHash(chainState.finalizedTxHash ?? chainState.pendingTxHash)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("details.blockNumber")}</span>
            <span>{chainState.blockNumber ?? "-"}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("details.updatedAt")}</span>
            <span>{new Date(chainState.updatedAtMs).toLocaleString()}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("details.noData")}</p>
      )}
    </Card>
  )
}
