import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useGuardedAction } from "@/hooks/use-guarded-action"
import { DidLabel } from "@/components/shared/DidLabel"
import { MemberStateBadge } from "@/components/shared/MemberStateBadge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { randomBytes32Hex } from "@/lib/bytes"
import { useConnectionStore } from "@/stores/connection"
import { useGroupStore } from "@/stores/group"
import { useIdentityStore } from "@/stores/identity"

interface GroupMemberListProps {
  groupId: string
}

type MemberView = "all" | "pending" | "finalized"

function formatDate(timestamp?: number): string {
  if (!timestamp) {
    return "-"
  }
  return new Date(timestamp).toLocaleString()
}

export function GroupMemberList({ groupId }: GroupMemberListProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("manage_groups")
  const sdk = useConnectionStore((state) => state.sdk)
  const selfDid = useIdentityStore((state) => state.self?.did)
  const loadMembers = useGroupStore((state) => state.loadMembers)
  const members = useGroupStore((state) => state.membersByGroupId[groupId] ?? [])
  const pagination = useGroupStore((state) => state.memberPaginationByGroupId[groupId])

  const [view, setView] = useState<MemberView>("all")
  const [page, setPage] = useState(1)

  useEffect(() => {
    void loadMembers(groupId, {
      view,
      page,
      perPage: 20,
    })
  }, [groupId, loadMembers, page, view])

  const canPrev = page > 1
  const canNext = pagination ? page < pagination.totalPages : members.length >= 20
  const title = useMemo(() => t("details.membersTitle"), [t])
  const canManage = canExecute && Boolean(sdk && selfDid)

  const refresh = () => {
    void loadMembers(groupId, {
      view,
      page,
      perPage: 20,
    })
  }

  return (
    <Card className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="flex items-center gap-1">
          {(["all", "pending", "finalized"] as const).map((item) => (
            <Button
              key={item}
              variant={item === view ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setView(item)
                setPage(1)
              }}
            >
              {item.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("details.did")}</TableHead>
            <TableHead>{t("details.state")}</TableHead>
            <TableHead>{t("details.joinedAt")}</TableHead>
            <TableHead>{t("group.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                {t("details.noMembers")}
              </TableCell>
            </TableRow>
          ) : (
            members.map((member) => (
              <TableRow key={`${member.did}-${member.joinedAtMs}`}>
                <TableCell>
                  <DidLabel did={member.did} />
                </TableCell>
                <TableCell>
                  <MemberStateBadge state={member.state} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(member.joinedAtMs)}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {canManage
                      && member.state === "PENDING"
                      && member.inviteId
                      && selfDid
                      && member.did === selfDid ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!sdk || !selfDid) {
                            return
                          }
                          void sdk
                            .groups.acceptInvite(groupId, member.inviteId!, {
                              inviteeDid: selfDid,
                              mlsWelcomeHash: randomBytes32Hex(),
                            })
                            .then(() => {
                              toast.success("Invitation accepted")
                              refresh()
                            })
                            .catch((error) => {
                              toast.error(error instanceof Error ? error.message : "Accept invite failed")
                            })
                        }}
                      >
                        {t("group.acceptInvite")}
                      </Button>
                    ) : null}

                    {canManage
                      && selfDid
                      && member.did !== selfDid
                      && member.state !== "REMOVED" ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive">
                            {t("group.removeMember")}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("group.removeMember")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("group.removeConfirm")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel asChild>
                              <Button variant="outline">{t("common.cancel")}</Button>
                            </AlertDialogCancel>
                            <AlertDialogAction asChild>
                              <Button
                                variant="destructive"
                                onClick={() => {
                                  if (!sdk || !selfDid) {
                                    return
                                  }
                                  void sdk
                                    .groups.removeMember(groupId, member.did, {
                                      operatorDid: selfDid,
                                      memberDid: member.did,
                                      mlsCommitHash: randomBytes32Hex(),
                                    })
                                    .then(() => {
                                      toast.success("Member removed")
                                      refresh()
                                    })
                                    .catch((error) => {
                                      toast.error(error instanceof Error ? error.message : "Remove member failed")
                                    })
                                }}
                              >
                                {t("group.removeMember")}
                              </Button>
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={!canPrev} onClick={() => setPage((value) => value - 1)}>
          {t("details.prev")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("details.page")} {page}
        </span>
        <Button variant="outline" size="sm" disabled={!canNext} onClick={() => setPage((value) => value + 1)}>
          {t("details.next")}
        </Button>
      </div>
    </Card>
  )
}
