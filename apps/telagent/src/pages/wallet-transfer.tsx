import { AlertCircleIcon, ArrowDownIcon, ArrowLeftIcon, CheckCircleIcon, LoaderIcon, WalletIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { DidAvatar } from "@/components/shared/DidAvatar"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupText,
} from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { useGuardedAction } from "@/hooks/use-guarded-action"
import { useSessionGuard } from "@/hooks/use-session-guard"
import { useContactStore } from "@/stores/contact"
import { useIdentityStore } from "@/stores/identity"
import { useWalletStore } from "@/stores/wallet"

const DID_PATTERN = /^did:claw:[A-Za-z0-9._:-]+$/

function compactDid(did: string): string {
  if (did.length <= 24) return did
  return `${did.slice(0, 12)}...${did.slice(-6)}`
}

export function WalletTransferPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { canExecute } = useGuardedAction("clawnet_transfer")
  const { withSession } = useSessionGuard()
  const transfer = useWalletStore((state) => state.transfer)
  const balance = useWalletStore((state) => state.balance)
  const refreshAll = useWalletStore((state) => state.refreshAll)
  const selfDid = useIdentityStore((state) => state.self?.did)
  const resolveContact = useContactStore((state) => state.resolve)

  const [toDid, setToDid] = useState("")
  const [amount, setAmount] = useState("")
  const [memo, setMemo] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // DID preview lookup
  type PreviewState = "idle" | "loading" | "found" | "not-found"
  const [previewState, setPreviewState] = useState<PreviewState>("idle")
  const [previewNickname, setPreviewNickname] = useState<string | undefined>()
  const [previewAvatar, setPreviewAvatar] = useState<string | undefined>()
  const [chainVerified, setChainVerified] = useState(false)
  const lookupRef = useRef(0)

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
        const [identity, profile] = await Promise.all([
          resolveContact(normalizedDid).catch(() => null),
          useContactStore.getState().fetchPeerProfile(normalizedDid).catch(() => null),
        ])
        if (seq !== lookupRef.current) return

        setPreviewState("found")
        setChainVerified(!!identity)

        if (profile) {
          setPreviewNickname(profile.nickname)
          setPreviewAvatar(
            profile.avatarUrl
              ? `/api/v1/profile/${encodeURIComponent(normalizedDid)}/avatar`
              : undefined,
          )
        } else {
          // Retry after P2P profile-card exchange
          setTimeout(async () => {
            if (seq !== lookupRef.current) return
            try {
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
            } catch {
              // ignore
            }
          }, 3000)
        }
      } catch {
        if (seq !== lookupRef.current) return
        setPreviewState("found")
        setChainVerified(false)
      }
    },
    [resolveContact, selfDid],
  )

  useEffect(() => {
    const normalizedDid = toDid.trim()
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
  }, [toDid])

  // Hold-to-send state
  const [holdProgress, setHoldProgress] = useState(0)
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const holdStartRef = useRef<number>(0)
  const HOLD_DURATION = 3000 // 3 seconds

  const tokenBalance = balance?.token ?? "0"
  const maxAmount = Math.floor(Number.parseFloat(tokenBalance)) || 0

  const isValid = (() => {
    const parsedAmount = Number.parseInt(amount, 10)
    return (
      toDid.trim().length > 0 &&
      Number.isFinite(parsedAmount) &&
      parsedAmount > 0 &&
      parsedAmount <= maxAmount &&
      String(parsedAmount) === amount.trim()
    )
  })()

  const handleSubmit = useCallback(async () => {
    const parsedAmount = Number.parseInt(amount, 10)
    if (!toDid.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error(t("wallet.transferValidation"))
      return
    }

    setSubmitting(true)
    try {
      await withSession(
        async (sessionToken) => {
          return transfer(sessionToken, {
            to: toDid.trim(),
            amount: parsedAmount,
            memo: memo.trim() || undefined,
          })
        },
        { requiredScope: ["transfer"] },
      )

      toast.success(t("wallet.transferSuccess"))
      await refreshAll()
      void navigate("/wallet")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("wallet.transferFailed"))
    } finally {
      setSubmitting(false)
    }
  }, [amount, memo, navigate, refreshAll, t, toDid, transfer, withSession])

  const clearHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current)
      holdTimerRef.current = null
    }
    setHoldProgress(0)
  }, [])

  const startHold = useCallback(() => {
    if (!isValid || submitting) return
    holdStartRef.current = Date.now()
    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current
      const progress = Math.min(elapsed / HOLD_DURATION, 1)
      setHoldProgress(progress)
      if (progress >= 1) {
        clearHold()
        void handleSubmit()
      }
    }, 50)
  }, [isValid, submitting, clearHold, handleSubmit])

  const endHold = useCallback(() => {
    clearHold()
  }, [clearHold])

  if (!canExecute) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("chat.observerHint")}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-lg flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-4">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/wallet">
            <ArrowLeftIcon className="size-4" />
          </Link>
        </Button>
        <h2 className="text-lg font-semibold">{t("wallet.transfer")}</h2>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="space-y-3 pt-2">
          {/* From card */}
          <div className="rounded-2xl border bg-card/60 p-4">
            <p className="text-xs font-medium text-muted-foreground">{t("wallet.filter.from")}</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <WalletIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t("wallet.title")}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {balance?.did ?? "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{tokenBalance}</p>
                <p className="text-[11px] text-muted-foreground">{t("wallet.token")}</p>
              </div>
            </div>
          </div>

          {/* Arrow separator */}
          <div className="flex justify-center">
            <span className="flex size-8 items-center justify-center rounded-full border bg-card">
              <ArrowDownIcon className="size-4 text-muted-foreground" />
            </span>
          </div>

          {/* To / Amount / Memo card */}
          <div className="rounded-2xl border bg-card/60 p-4">
            <FieldGroup>
              {/* Receiver DID */}
              <Field>
                <FieldLabel>{t("wallet.toDid")}</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>did:claw:</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={toDid.replace(/^did:claw:/, "")}
                    onChange={(e) => setToDid(`did:claw:${e.target.value}`)}
                    placeholder="address"
                    disabled={submitting}
                  />
                </InputGroup>

                {/* Recipient preview */}
                {previewState !== "idle" && (
                  <div className="mt-1 flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                    {previewState === "loading" && (
                      <>
                        <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">{t("contact.lookingUp")}</span>
                      </>
                    )}
                    {previewState === "found" && (
                      <>
                        <DidAvatar did={toDid.trim()} avatarUrl={previewAvatar} className="size-9" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {previewNickname || compactDid(toDid.trim())}
                          </p>
                          {chainVerified ? (
                            <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                              <CheckCircleIcon className="size-3" />
                              {t("contact.identityFound")}
                            </p>
                          ) : (
                            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-yellow-400">
                              <AlertCircleIcon className="size-3" />
                              {t("contact.identityNotFound")}
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Field>

              <hr className="border-border/50" />

              {/* Amount */}
              <Field data-invalid={!!(amount && Number.parseInt(amount, 10) > maxAmount)}>
                <div className="flex items-center justify-between">
                  <FieldLabel>{t("wallet.amount")}</FieldLabel>
                  <button
                    type="button"
                    className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary transition hover:bg-primary/20"
                    onClick={() => setAmount(String(Math.floor(maxAmount)))}
                    disabled={submitting}
                  >
                    MAX
                  </button>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={maxAmount}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0"
                  aria-invalid={!!(amount && Number.parseInt(amount, 10) > maxAmount)}
                  disabled={submitting}
                />
                {amount && Number.parseInt(amount, 10) > maxAmount && (
                  <p className="text-xs text-destructive">{t("wallet.transferValidation")}</p>
                )}
              </Field>

              <hr className="border-border/50" />

              {/* Memo */}
              <Field>
                <FieldLabel>{t("wallet.memo")}</FieldLabel>
                <Textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder={t("wallet.memo")}
                  disabled={submitting}
                  className="resize-none"
                />
              </Field>
            </FieldGroup>
          </div>
        </div>

        {/* Hold to send button */}
        <div className="mt-6">
          <button
            type="button"
            className="relative w-full select-none overflow-hidden rounded-2xl bg-primary px-4 py-4 text-sm font-semibold text-primary-foreground transition disabled:opacity-50"
            disabled={!isValid || submitting}
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* Progress fill */}
            {holdProgress > 0 && (
              <span
                className="absolute inset-0 bg-primary-foreground/20 transition-none"
                style={{ width: `${holdProgress * 100}%` }}
              />
            )}
            <span className="relative">
              {submitting
                ? t("wallet.submitting")
                : holdProgress > 0
                  ? `${Math.ceil((1 - holdProgress) * (HOLD_DURATION / 1000))}s...`
                  : t("wallet.holdToSend")}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
