import { AlertCircleIcon, CheckCircleIcon, LoaderIcon, PlusIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { DidAvatar } from "@/components/shared/DidAvatar"
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
import { useContactStore } from "@/stores/contact"
import { useConversationStore } from "@/stores/conversation"
import { useConnectionStore } from "@/stores/connection"
import { useIdentityStore } from "@/stores/identity"

interface AddContactDialogProps {
  compact?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

const DID_PATTERN = /^did:claw:[A-Za-z0-9._:-]+$/

function compactDid(did: string): string {
  if (did.length <= 24) {
    return did
  }
  return `${did.slice(0, 12)}...${did.slice(-6)}`
}

function directConversationIdForDid(did: string): string {
  return `direct:${did}`
}

export function AddContactDialog({
  compact = false,
  open,
  onOpenChange,
  hideTrigger = false,
}: AddContactDialogProps) {
  const { t } = useTranslation()
  const { canExecute } = useGuardedAction("manage_contacts")
  const selfDid = useIdentityStore((state) => state.self?.did)
  const addContact = useContactStore((state) => state.addContact)
  const resolveContact = useContactStore((state) => state.resolve)
  const sdk = useConnectionStore((state) => state.sdk)
  const refreshConversations = useConversationStore((state) => state.refreshFromApi)
  const setSelectedConversationId = useConversationStore((state) => state.setSelectedConversationId)

  const [internalOpen, setInternalOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [did, setDid] = useState("")
  const [displayName, setDisplayName] = useState("")
  const dialogOpen = typeof open === "boolean" ? open : internalOpen

  /* ── DID preview lookup ── */
  type PreviewState = "idle" | "loading" | "found" | "not-found"
  const [previewState, setPreviewState] = useState<PreviewState>("idle")
  const [previewNickname, setPreviewNickname] = useState<string | undefined>()
  const [previewAvatar, setPreviewAvatar] = useState<string | undefined>()
  const [chainVerified, setChainVerified] = useState(false)
  const lookupRef = useRef(0) // debounce guard

  // React to SSE-driven profile-update: when the store gets a new profile
  // for the DID currently shown in the dialog, update the preview immediately.
  const normalizedDid = did.trim()
  const storedProfile = useContactStore((state) =>
    DID_PATTERN.test(normalizedDid) ? state.peerProfiles[normalizedDid] : undefined,
  )
  useEffect(() => {
    if (!storedProfile || previewState === "idle" || previewState === "loading") return
    if (!previewNickname && !previewAvatar) {
      // We were waiting for the profile — populate preview now
      setPreviewNickname(storedProfile.nickname)
      setPreviewAvatar(
        storedProfile.avatarUrl
          ? `/api/v1/profile/${encodeURIComponent(normalizedDid)}/avatar`
          : undefined,
      )
      if (storedProfile.nickname && !displayName) {
        setDisplayName(storedProfile.nickname)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedProfile])

  const lookupDid = useCallback(
    async (rawDid: string) => {
      const normalizedDid = rawDid.trim()
      const seq = ++lookupRef.current

      if (!DID_PATTERN.test(normalizedDid) || (selfDid && normalizedDid === selfDid)) {
        setPreviewState("idle")
        setPreviewNickname(undefined)
        setPreviewAvatar(undefined)
        setChainVerified(false)
        return
      }

      setPreviewState("loading")
      setPreviewNickname(undefined)
      setPreviewAvatar(undefined)
      setChainVerified(false)

      try {
        // Run identity resolve and peer profile fetch in parallel.
        // The profile fetch also triggers a P2P profile-card request on cache miss,
        // so a retry after a short delay may succeed.
        const [identity, profile] = await Promise.all([
          resolveContact(normalizedDid).catch(() => null),
          useContactStore.getState().fetchPeerProfile(normalizedDid).catch(() => null),
        ])
        if (seq !== lookupRef.current) return // stale

        // Always show "found" as long as the DID format is valid — user can still add
        setPreviewState("found")
        setChainVerified(!!identity)

        if (profile) {
          setPreviewNickname(profile.nickname)
          // Use local proxy URL — the raw avatarUrl points to the peer's node
          // which may be unreachable from the browser (NAT / CORS).
          setPreviewAvatar(
            profile.avatarUrl
              ? `/api/v1/profile/${encodeURIComponent(normalizedDid)}/avatar`
              : undefined,
          )
          if (profile.nickname && !displayName) {
            setDisplayName(profile.nickname)
          }
        } else {
          // No cached profile yet — the server sent a P2P request.
          // Retry after a delay to pick up the reply.
          setTimeout(async () => {
            if (seq !== lookupRef.current) return
            try {
              // Clear stale cache entry so the SDK re-fetches
              useContactStore.setState((s) => {
                const copy = { ...s.peerProfiles }
                delete copy[normalizedDid]
                return { peerProfiles: copy }
              })
              const retried = await useContactStore.getState().fetchPeerProfile(normalizedDid).catch(() => null)
              if (seq !== lookupRef.current || !retried) return
              setPreviewNickname(retried.nickname)
              setPreviewAvatar(
                retried.avatarUrl
                  ? `/api/v1/profile/${encodeURIComponent(normalizedDid)}/avatar`
                  : undefined,
              )
              if (retried.nickname && !displayName) {
                setDisplayName(retried.nickname)
              }
            } catch {
              // ignore
            }
          }, 3000)
        }
      } catch {
        if (seq !== lookupRef.current) return
        // Even on error, show as found (unverified) — DID format is valid
        setPreviewState("found")
        setChainVerified(false)
      }
    },
    [resolveContact, selfDid, displayName],
  )

  // Debounced lookup when DID changes
  useEffect(() => {
    const normalizedDid = did.trim()
    if (!DID_PATTERN.test(normalizedDid)) {
      setPreviewState("idle")
      setPreviewNickname(undefined)
      setPreviewAvatar(undefined)
      return
    }
    const timer = setTimeout(() => {
      void lookupDid(normalizedDid)
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [did])

  const title = useMemo(() => t("contact.add"), [t])

  const reset = () => {
    setDid("")
    setDisplayName("")
    setPreviewState("idle")
    setPreviewNickname(undefined)
    setPreviewAvatar(undefined)
    setChainVerified(false)
    lookupRef.current++
  }

  const setDialogOpen = (nextOpen: boolean) => {
    if (typeof open !== "boolean") {
      setInternalOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
    if (!nextOpen) {
      reset()
    }
  }

  const onSubmit = async () => {
    const normalizedDid = did.trim()
    if (!DID_PATTERN.test(normalizedDid)) {
      toast.error(t("contact.invalidDid"))
      return
    }

    if (selfDid && normalizedDid === selfDid) {
      toast.error(t("contact.selfNotAllowed"))
      return
    }

    setPending(true)
    try {
      const resolvedIdentity = await resolveContact(normalizedDid)
      const conversationId = directConversationIdForDid(normalizedDid)
      const nameCandidate = displayName.trim() || resolvedIdentity?.did || compactDid(normalizedDid)

      await addContact(normalizedDid, nameCandidate)

      if (sdk) {
        await sdk.conversations.create({
          conversationId,
          conversationType: "direct",
          peerDid: normalizedDid,
          displayName: nameCandidate,
        })
      }

      await refreshConversations()
      setSelectedConversationId(conversationId)
      toast.success(t("contact.addSuccess"))
      setDialogOpen(false)

      // Delayed re-fetch: profile card exchange via P2P is async;
      // re-fetch after a few seconds to pick up the peer's nickname and avatar.
      setTimeout(() => {
        void refreshConversations()
        void useContactStore.getState().loadContacts()
      }, 3_000)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("contact.addFailed"))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {!hideTrigger ? (
        <DialogTrigger asChild>
          {compact ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
              disabled={!canExecute}
              aria-label={title}
            >
              <PlusIcon className="size-3.5" />
            </Button>
          ) : (
            <Button size="sm" className="gap-1.5" disabled={!canExecute}>
              <PlusIcon className="size-4" />
              {title}
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("contact.addDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="contact-did">{t("contact.did")}</Label>
            <Input
              id="contact-did"
              value={did}
              placeholder="did:claw:..."
              onChange={(event) => setDid(event.target.value)}
              disabled={pending}
            />
          </div>

          {/* preview card */}
          {previewState !== "idle" && (
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
              {previewState === "loading" && (
                <>
                  <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{t("contact.lookingUp")}</span>
                </>
              )}
              {previewState === "found" && (
                <>
                  <DidAvatar did={did.trim()} avatarUrl={previewAvatar} className="size-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {previewNickname || compactDid(did.trim())}
                    </p>
                    {chainVerified ? (
                      <p className="flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircleIcon className="size-3" />
                        {t("contact.identityFound")}
                      </p>
                    ) : (
                      <p className="flex items-center gap-1 text-xs text-yellow-400">
                        <AlertCircleIcon className="size-3" />
                        {t("contact.identityNotFound")}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="contact-display-name">{t("contact.displayName")}</Label>
            <Input
              id="contact-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={pending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={pending}>
            {pending ? t("common.loading") : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
