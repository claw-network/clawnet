import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { GroupChainState } from "@/components/group/GroupChainState"
import { GroupMemberList } from "@/components/group/GroupMemberList"
import { InviteMemberDialog } from "@/components/group/InviteMemberDialog"
import { ChainStateBadge } from "@/components/shared/ChainStateBadge"
import { DidLabel } from "@/components/shared/DidLabel"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useGroupStore } from "@/stores/group"

interface GroupDetailProps {
  groupId: string
}

export function GroupDetail({ groupId }: GroupDetailProps) {
  const { t } = useTranslation()
  const loadBundle = useGroupStore((state) => state.loadBundle)
  const group = useGroupStore((state) => state.groupsById[groupId])
  const chainState = useGroupStore((state) => state.chainStateByGroupId[groupId])
  const loading = useGroupStore((state) => state.loadingByGroupId[groupId] ?? false)
  const error = useGroupStore((state) => state.errorByGroupId[groupId])

  useEffect(() => {
    void loadBundle(groupId)
  }, [groupId, loadBundle])

  if (!group && loading) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </Card>
    )
  }

  if (!group) {
    return (
      <Card className="p-4">
        <h2 className="text-sm font-semibold">{t("details.groupTitle")}</h2>
        <p className="mt-2 text-xs text-muted-foreground">{error ?? t("details.noData")}</p>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("details.groupTitle")}</h2>
          <InviteMemberDialog
            groupId={groupId}
            onInvited={() => {
              void loadBundle(groupId)
            }}
          />
        </div>
        <Separator />
        <div className="space-y-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("details.groupId")}</p>
            <p className="text-xs font-mono">{group.groupId}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("details.groupDomain")}</p>
            <p className="text-xs">{group.groupDomain}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("details.creatorDid")}</p>
            <DidLabel did={group.creatorDid} />
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">{t("details.state")}</p>
            <ChainStateBadge state={chainState?.state ?? group.state} />
          </div>
        </div>
      </Card>

      <GroupChainState groupId={groupId} />
      <GroupMemberList groupId={groupId} />
    </div>
  )
}
