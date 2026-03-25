import { useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { DidAvatar } from "@/components/shared/DidAvatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { useConnectionStore } from "@/stores/connection"
import { useIdentityStore } from "@/stores/identity"
import { usePermissionStore } from "@/stores/permission"

declare const __TELAGENT_TLS__: boolean
declare const __TELAGENT_TLS_PORT__: string
declare const __TELAGENT_API_PORT__: string

const LOCAL_NODE_URL = typeof __TELAGENT_TLS__ !== "undefined" && __TELAGENT_TLS__
  ? `https://127.0.0.1:${__TELAGENT_TLS_PORT__}`
  : location.protocol === "https:"
    ? `https://127.0.0.1:${typeof __TELAGENT_TLS_PORT__ !== "undefined" ? __TELAGENT_TLS_PORT__ : "9443"}`
    : `http://127.0.0.1:${typeof __TELAGENT_API_PORT__ !== "undefined" ? __TELAGENT_API_PORT__ : "9529"}`
const DID_REGEX = /^did:claw:z[A-Za-z0-9]{32,}$/

const DEFAULT_GATEWAYS = [
  { label: "alex.telagent.org", value: "https://alex.telagent.org" },
  { label: "bess.telagent.org", value: "https://bess.telagent.org" },
]

type InputMode = "did" | "url"

function detectInputMode(value: string): InputMode {
  const trimmed = value.trim()
  if (!trimmed) return "did"
  if (DID_REGEX.test(trimmed) || trimmed.startsWith("did:")) return "did"
  return "url"
}

function isDidInput(value: string): boolean {
  return DID_REGEX.test(value.trim())
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/*  Generic node probe (re-runs when targetUrl changes)              */
/* ------------------------------------------------------------------ */

interface NodeInfo {
  did: string
  didHash: string
  version: string
  nickname?: string
  avatarUrl?: string
}

type ProbeStatus = "probing" | "found" | "not-found"

function useNodeProbe(targetUrl: string) {
  const [status, setStatus] = useState<ProbeStatus>("probing")
  const [info, setInfo] = useState<NodeInfo | null>(null)

  useEffect(() => {
    if (!targetUrl) return
    const controller = new AbortController()
    setStatus("probing")
    setInfo(null)

    async function probe() {
      try {
        const nodeRes = await fetch(new URL("/api/v1/node", targetUrl).toString(), {
          signal: controller.signal,
          headers: { accept: "application/json" },
        })
        if (!nodeRes.ok) throw new Error("node probe failed")
        const nodeBody = await nodeRes.json()
        const node = nodeBody.data ?? nodeBody

        const selfRes = await fetch(new URL("/api/v1/identities/self", targetUrl).toString(), {
          signal: controller.signal,
          headers: { accept: "application/json" },
        })
        if (!selfRes.ok) throw new Error("identity probe failed")
        const selfBody = await selfRes.json()
        const self = selfBody.data ?? selfBody

        // Profile is public — fetch nickname & avatar
        let nickname: string | undefined
        let avatarUrl: string | undefined
        try {
          const profRes = await fetch(new URL("/api/v1/profile", targetUrl).toString(), {
            signal: controller.signal,
            headers: { accept: "application/json" },
          })
          if (profRes.ok) {
            const profBody = await profRes.json()
            const prof = profBody.data ?? profBody
            nickname = prof.nickname || undefined
            avatarUrl = prof.avatarUrl || undefined
          }
        } catch { /* profile fetch is best-effort */ }

        setInfo({
          did: self.did ?? "",
          didHash: self.didHash ?? "",
          version: node.version ?? "unknown",
          nickname,
          avatarUrl,
        })
        setStatus("found")
      } catch {
        if (!controller.signal.aborted) {
          setInfo(null)
          setStatus("not-found")
        }
      }
    }

    void probe()
    return () => controller.abort()
  }, [targetUrl])

  return { status, info }
}

/* ------------------------------------------------------------------ */
/*  DID probe (via gateway relay)                                     */
/* ------------------------------------------------------------------ */

type DidProbeStatus = "idle" | "probing" | "reachable" | "unreachable"

function useDidProbe(did: string, gatewayUrl: string) {
  const [status, setStatus] = useState<DidProbeStatus>("idle")
  const [latencyMs, setLatencyMs] = useState(-1)
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null)

  useEffect(() => {
    if (!did || !gatewayUrl || !isDidInput(did)) {
      setStatus("idle")
      setNodeInfo(null)
      setLatencyMs(-1)
      return
    }
    const controller = new AbortController()
    setStatus("probing")

    async function probe() {
      try {
        const encodedDid = encodeURIComponent(did.trim())

        // 1. Ping via gateway
        const pingRes = await fetch(
          `${gatewayUrl}/relay/${encodedDid}/ping`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        )
        const pingData = await pingRes.json()
        if (!pingData.data?.reachable) {
          setStatus("unreachable")
          return
        }
        setLatencyMs(pingData.data.latencyMs)

        // 2. Fetch node info via gateway
        const nodeRes = await fetch(
          `${gatewayUrl}/relay/${encodedDid}/api/v1/node`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        )
        const nodeBody = await nodeRes.json()
        const node = nodeBody.data ?? nodeBody

        // 3. Fetch identity
        const selfRes = await fetch(
          `${gatewayUrl}/relay/${encodedDid}/api/v1/identities/self`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        )
        const selfBody = await selfRes.json()
        const self = selfBody.data ?? selfBody

        setNodeInfo({
          did: self.did ?? did.trim(),
          didHash: self.didHash ?? "",
          version: node.version ?? "unknown",
        })
        setStatus("reachable")
      } catch {
        if (!controller.signal.aborted) {
          setStatus("unreachable")
        }
      }
    }

    void probe()
    return () => controller.abort()
  }, [did, gatewayUrl])

  return { status, latencyMs, nodeInfo }
}

/* ------------------------------------------------------------------ */
/*  Avatar probe display                                              */
/* ------------------------------------------------------------------ */

function NodeAvatar({ status, info, isLocal, targetUrl }: { status: ProbeStatus; info: NodeInfo | null; isLocal: boolean; targetUrl?: string }) {
  const { t } = useTranslation()

  const isFound = status === "found" && info

  const foundLabel = isLocal ? t("connect.local.found") : t("connect.remote.found")
  const detectingLabel = isLocal ? t("connect.local.detecting") : t("connect.remote.detecting")
  const notFoundLabel = isLocal ? t("connect.local.notFound") : t("connect.remote.notFound")

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      {/* Avatar ring container */}
      <div className="relative">
        {/* Glow effect when found */}
        {isFound && (
          <div className="absolute inset-[-8px] rounded-full bg-primary/8 blur-md" />
        )}

        {/* Ring */}
        <div
          className={cn(
            "absolute inset-[-4px] rounded-full transition-all duration-700",
            status === "probing" && "border-[2.5px] border-transparent border-t-primary border-r-primary/40 animate-spin",
            isFound && "border-[2.5px] border-primary/25",
            status === "not-found" && "border-[2px] border-dashed border-muted-foreground/15",
          )}
        />

        {/* Avatar */}
        {isFound ? (
          <DidAvatar did={info.did} avatarUrl={info.avatarUrl} baseUrl={targetUrl} className="relative size-[72px] text-2xl" />
        ) : (
          <Avatar className="relative size-[72px]">
            <AvatarFallback
              className={cn(
                "text-2xl transition-colors duration-500",
                status === "probing"
                  ? "bg-muted text-muted-foreground/60"
                  : "bg-muted/60 text-muted-foreground/30",
              )}
            >
              {status === "probing" ? "..." : "?"}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      {/* Status text */}
      <div className="flex flex-col items-center gap-2">
        {isFound && (
          <>
            {info.nickname && (
              <p className="text-sm font-medium text-foreground">
                {info.nickname}
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-500" />
              <span className="text-sm font-medium text-foreground">
                {foundLabel}
              </span>
              <Badge variant="secondary" className="px-2 py-0 text-[10px] font-normal">
                v{info.version}
              </Badge>
            </div>
            <p className="max-w-[300px] truncate font-mono text-[11px] leading-none text-muted-foreground/70">
              {info.did}
            </p>
          </>
        )}
        {status === "probing" && (
          <span className="text-[13px] text-muted-foreground">
            {detectingLabel}
          </span>
        )}
        {status === "not-found" && (
          <span className="text-[13px] text-muted-foreground/70">
            {notFoundLabel}
          </span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Local node shortcut card                                          */
/* ------------------------------------------------------------------ */

function LocalNodeCard({
  probeStatus,
  info,
  onUse,
}: {
  probeStatus: ProbeStatus
  info: NodeInfo | null
  onUse: () => void
}) {
  const { t } = useTranslation()
  if (probeStatus !== "found" || !info) return null

  return (
    <button
      type="button"
      onClick={onUse}
      className="group mt-3 flex w-full items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3.5 py-3 text-left transition-colors hover:bg-muted/60"
    >
      <div className="relative shrink-0">
        <div className="absolute inset-[-3px] rounded-full border-[2px] border-primary/20" />
        <DidAvatar did={info.did} avatarUrl={info.avatarUrl} baseUrl={LOCAL_NODE_URL} className="relative size-9 text-sm" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="text-[13px] font-medium">
            {info.nickname || t("connect.local.found")}
          </span>
          <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-normal">
            v{info.version}
          </Badge>
        </div>
        <p className="truncate font-mono text-[10px] text-muted-foreground/70">
          {info.did}
        </p>
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground group-hover:text-foreground">
        {t("connect.local.useLocal")}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Connect form                                                      */
/* ------------------------------------------------------------------ */

export function ConnectForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const connect = useConnectionStore((state) => state.connect)
  const status = useConnectionStore((state) => state.status)
  const error = useConnectionStore((state) => state.error)
  const loadSelf = useIdentityStore((state) => state.loadSelf)
  const refreshPermissions = usePermissionStore((state) => state.refresh)

  // Always probe local node in background for the shortcut card
  const { status: localProbeStatus, info: localProbeInfo } = useNodeProbe(LOCAL_NODE_URL)

  // Remote URL probe — only when user types a URL
  const [remoteProbeTarget, setRemoteProbeTarget] = useState("")
  const { status: remoteProbeStatus, info: remoteProbeInfo } = useNodeProbe(remoteProbeTarget)

  const [nodeInput, setNodeInput] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  // Input mode: "did" (default) or "url"
  const inputMode = detectInputMode(nodeInput)
  const isDid = inputMode === "did" && isDidInput(nodeInput)

  // DID mode state
  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_GATEWAYS[0].value)
  const { status: didProbeStatus, latencyMs, nodeInfo: didNodeInfo } = useDidProbe(
    isDid ? nodeInput : "",
    gatewayUrl,
  )

  const onInputChange = (value: string) => {
    setNodeInput(value)
  }

  const onInputBlur = () => {
    const trimmed = nodeInput.trim()
    if (!trimmed || detectInputMode(trimmed) === "did") {
      setRemoteProbeTarget("")
      return
    }
    try {
      new URL(trimmed)
      if (!isLocalUrl(trimmed)) {
        setRemoteProbeTarget(trimmed)
      }
    } catch {
      setRemoteProbeTarget("")
    }
  }

  const useLocalNode = () => {
    setNodeInput(LOCAL_NODE_URL)
    setRemoteProbeTarget("")
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLocalError(null)
    try {
      if (isDid) {
        const trimmedDid = nodeInput.trim()
        const relayNodeUrl = `${gatewayUrl}/relay/${encodeURIComponent(trimmedDid)}`
        await connect({
          nodeUrl: relayNodeUrl,
          passphrase,
          connectionMode: "relay",
          targetDid: trimmedDid,
          gatewayUrl,
        })
      } else {
        await connect({ nodeUrl: nodeInput.trim(), passphrase })
      }
      await loadSelf()
      await refreshPermissions()
      navigate("/chat")
    } catch (submitError) {
      setLocalError(submitError instanceof Error ? submitError.message : t("connect.failed"))
    }
  }

  const displayError = localError ?? error

  // Determine avatar section state
  const isUrlMode = inputMode === "url" && !!nodeInput.trim()
  const showUrlAvatar = isUrlMode && (isLocalUrl(nodeInput.trim())
    ? localProbeStatus !== "not-found"
    : remoteProbeTarget && remoteProbeStatus !== "not-found")

  const effectiveProbeStatus: ProbeStatus = isDid
    ? (didProbeStatus === "reachable" ? "found" : didProbeStatus === "unreachable" ? "not-found" : "probing")
    : isUrlMode
      ? (isLocalUrl(nodeInput.trim()) ? localProbeStatus : (remoteProbeTarget ? remoteProbeStatus : "probing"))
      : "probing"
  const effectiveInfo = isDid
    ? didNodeInfo
    : isUrlMode
      ? (isLocalUrl(nodeInput.trim()) ? localProbeInfo : remoteProbeInfo)
      : null

  const effectiveTargetUrl = isDid
    ? gatewayUrl
    : isUrlMode
      ? (isLocalUrl(nodeInput.trim()) ? LOCAL_NODE_URL : remoteProbeTarget)
      : LOCAL_NODE_URL

  const showAvatarSection = isDid
    ? didProbeStatus !== "idle"
    : showUrlAvatar

  const canSubmit = !!nodeInput.trim() && !!passphrase

  return (
    <div className="flex w-full max-w-[420px] flex-col items-center gap-8">
      {/* Title area */}
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("connect.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("connect.subtitle")}</p>
      </div>

      {/* Card */}
      <Card className="w-full border-border/60 py-0 gap-0 shadow-lg">
        <CardContent className="px-6 pt-0 pb-6">
          <form onSubmit={onSubmit}>
            {showAvatarSection && (
              <>
                <NodeAvatar
                  status={effectiveProbeStatus}
                  info={effectiveInfo}
                  isLocal={isUrlMode && isLocalUrl(nodeInput.trim())}
                  targetUrl={effectiveTargetUrl}
                />
                {isDid && latencyMs > 0 && (
                  <div className="flex justify-center -mt-2 mb-2">
                    <Badge variant="secondary" className="px-2 py-0 text-[10px] font-normal">
                      {latencyMs}ms
                    </Badge>
                  </div>
                )}
                <Separator className="mb-5" />
              </>
            )}

            <div className={cn("space-y-4", !showAvatarSection && "pt-6")}>
              {/* Unified input: DID-first, URL also accepted */}
              <div>
                <Label htmlFor="node-input" className="mb-2 block text-[13px]">
                  {isDid ? t("connect.did.label") : (isUrlMode ? t("connect.nodeUrl") : t("connect.inputLabel"))}
                </Label>
                <Input
                  id="node-input"
                  placeholder="did:claw:z...  or  https://..."
                  value={nodeInput}
                  onChange={(event) => onInputChange(event.target.value)}
                  onBlur={onInputBlur}
                  autoFocus
                />
                {isDid && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("connect.did.hint")}
                  </p>
                )}
                {!nodeInput && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("connect.inputHint")}
                  </p>
                )}
              </div>

              {/* Gateway selector — only in DID mode */}
              {isDid && (
                <div>
                  <Label htmlFor="gateway" className="mb-2 block text-[13px]">
                    {t("connect.did.gateway")}
                  </Label>
                  <Select value={gatewayUrl} onValueChange={setGatewayUrl}>
                    <SelectTrigger id="gateway" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEFAULT_GATEWAYS.map((gw) => (
                        <SelectItem key={gw.value} value={gw.value}>{gw.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Passphrase */}
              <div>
                <Label htmlFor="passphrase" className="mb-2 block text-[13px]">
                  {t("connect.passphrase")}
                </Label>
                <Input
                  id="passphrase"
                  type="password"
                  placeholder="••••••••"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            {displayError ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{displayError}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="submit"
              className="mt-5 w-full"
              disabled={status === "connecting" || !canSubmit}
            >
              {status === "connecting" ? t("connect.connecting") : t("connect.submit")}
            </Button>

            {/* Local node shortcut — shown when user hasn't typed anything or is in DID mode */}
            {!isUrlMode && (
              <LocalNodeCard
                probeStatus={localProbeStatus}
                info={localProbeInfo}
                onUse={useLocalNode}
              />
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
