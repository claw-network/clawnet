import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { AgentIdentityView } from "@/lib/telagent-client"

import { DidLabel } from "@/components/shared/DidLabel"
import { ReputationStars } from "@/components/shared/ReputationStars"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useConnectionStore } from "@/stores/connection"
import { useContactStore } from "@/stores/contact"

interface ContactDetailProps {
  did: string
}

interface ContactProfileData {
  identity?: {
    address?: string
    controller?: string
    activeKey?: string
    isActive?: boolean
  }
  reputation?: {
    score?: number
    reviewCount?: number
  } | null
}

interface DataEnvelope<T> {
  data: T
}

async function fetchContactProfile(
  nodeUrl: string,
  did: string,
  accessToken?: string,
): Promise<ContactProfileData | null> {
  const response = await fetch(`${nodeUrl}/api/v1/clawnet/profile/${encodeURIComponent(did)}`, {
    headers: {
      accept: "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    signal: AbortSignal.timeout(7_000),
  })

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as DataEnvelope<ContactProfileData>
  return payload?.data ?? null
}

type ExtendedIdentity = AgentIdentityView & {
  capabilities?: unknown
  keyHistory?: unknown
}

function asKeyHistory(identity: ExtendedIdentity | undefined): unknown[] {
  if (!identity) {
    return []
  }
  const value = identity.keyHistory
  return Array.isArray(value) ? value : []
}

function asCapabilities(identity: ExtendedIdentity | undefined): string[] {
  if (!identity) {
    return []
  }
  const value = identity.capabilities
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === "string")
}

export function ContactDetail({ did }: ContactDetailProps) {
  const { t } = useTranslation()
  const resolve = useContactStore((state) => state.resolve)
  const identity = useContactStore((state) => state.identitiesByDid[did])
  const loading = useContactStore((state) => state.loadingByDid[did] ?? false)
  const contactError = useContactStore((state) => state.errorByDid[did])
  const nodeUrl = useConnectionStore((state) => state.nodeUrl)
  const sessionToken = useConnectionStore((state) => state.sessionToken)

  const [profile, setProfile] = useState<ContactProfileData | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    if (!did) {
      return
    }
    void resolve(did)
  }, [did, resolve])

  useEffect(() => {
    if (!did || !nodeUrl) {
      return
    }
    let cancelled = false

    setProfileLoading(true)
    void fetchContactProfile(nodeUrl, did, sessionToken || undefined)
      .then((result) => {
        if (cancelled) {
          return
        }
        setProfile(result)
      })
      .finally(() => {
        if (!cancelled) {
          setProfileLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionToken, did, nodeUrl])

  const extendedIdentity = identity as ExtendedIdentity | undefined
  const capabilities = asCapabilities(extendedIdentity)
  const keyHistory = asKeyHistory(extendedIdentity)
  const reputationScore = profile?.reputation?.score ?? 0
  const reviewCount = profile?.reputation?.reviewCount ?? 0

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">{t("details.contactTitle")}</h2>
        <DidLabel did={did} className="mt-2" />
      </div>
      <Separator />

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ) : (
        <Tabs defaultValue="identity">
          <TabsList variant="line" className="w-full">
            <TabsTrigger value="identity">{t("details.identityTab")}</TabsTrigger>
            <TabsTrigger value="profile">{t("details.profileTab")}</TabsTrigger>
            <TabsTrigger value="reputation">{t("details.reputationTab")}</TabsTrigger>
          </TabsList>

          <TabsContent value="identity" className="space-y-3 pt-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("details.controller")}</p>
              <p className="text-xs">{identity?.controller ?? "-"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("details.publicKey")}</p>
              <p className="text-xs font-mono">{identity?.publicKey ?? "-"}</p>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">{t("details.status")}</p>
              <Badge variant={identity?.isActive ? "success" : "destructive"}>
                {identity?.isActive ? t("details.active") : t("details.inactive")}
              </Badge>
            </div>
            {contactError ? <p className="text-xs text-destructive">{contactError}</p> : null}
          </TabsContent>

          <TabsContent value="profile" className="space-y-3 pt-2">
            {profileLoading ? <Skeleton className="h-5 w-2/3" /> : null}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("details.address")}</p>
              <p className="break-all text-xs">{profile?.identity?.address ?? "-"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("details.activeKey")}</p>
              <p className="break-all text-xs font-mono">{profile?.identity?.activeKey ?? identity?.publicKey ?? "-"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("details.capabilities")}</p>
              {capabilities.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("details.noData")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {capabilities.map((item) => (
                    <Badge key={item} variant="secondary">
                      {item}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("details.keyHistory")}</p>
              <p className="text-xs">{keyHistory.length}</p>
            </div>
          </TabsContent>

          <TabsContent value="reputation" className="space-y-3 pt-2">
            <ReputationStars score={reputationScore} reviews={reviewCount} />
            <p className="text-xs text-muted-foreground">
              {t("details.reviews", { count: reviewCount })}
            </p>
          </TabsContent>
        </Tabs>
      )}
    </Card>
  )
}
