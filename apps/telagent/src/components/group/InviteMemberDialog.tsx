import { UserPlusIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useGuardedAction } from "@/hooks/use-guarded-action"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { randomBytes32Hex } from "@/lib/bytes"
import { useConnectionStore } from "@/stores/connection"
import { useIdentityStore } from "@/stores/identity"

interface InviteMemberDialogProps {
  groupId: string
  onInvited?: () => void
}

export function InviteMemberDialog({ groupId, onInvited }: InviteMemberDialogProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("manage_groups")
  const sdk = useConnectionStore((state) => state.sdk)
  const selfDid = useIdentityStore((state) => state.self?.did)

  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [inviteeDid, setInviteeDid] = useState("")
  const [inviteId, setInviteId] = useState(() => randomBytes32Hex())
  const [mlsCommitHash, setMlsCommitHash] = useState(() => randomBytes32Hex())

  if (!canExecute) {
    return null
  }

  const canSubmit = Boolean(sdk && selfDid && inviteeDid.trim()) && !pending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <UserPlusIcon className="size-4" />
          {t("group.invite")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("group.invite")}</DialogTitle>
          <DialogDescription>{t("group.inviteDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("group.inviteeDid")}</Label>
            <Input
              placeholder="did:claw:..."
              value={inviteeDid}
              onChange={(event) => setInviteeDid(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("group.inviteId")}</Label>
            <Input value={inviteId} onChange={(event) => setInviteId(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("group.mlsCommitHash")}</Label>
            <Input value={mlsCommitHash} onChange={(event) => setMlsCommitHash(event.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => {
            setInviteId(randomBytes32Hex())
            setMlsCommitHash(randomBytes32Hex())
          }}>
            {t("group.regenerate")}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (!sdk || !selfDid) {
                return
              }
              setPending(true)
              void sdk
                .groups.invite(groupId, {
                  inviterDid: selfDid,
                  inviteeDid: inviteeDid.trim(),
                  inviteId: inviteId.trim(),
                  mlsCommitHash: mlsCommitHash.trim(),
                })
                .then(() => {
                  toast.success("Invitation submitted")
                  setOpen(false)
                  setInviteeDid("")
                  onInvited?.()
                })
                .catch((error) => {
                  toast.error(error instanceof Error ? error.message : "Invite failed")
                })
                .finally(() => {
                  setPending(false)
                })
            }}
          >
            {pending ? t("common.loading") : t("group.invite")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
