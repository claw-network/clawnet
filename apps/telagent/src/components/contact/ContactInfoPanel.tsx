import { EllipsisIcon, MessageCircleIcon, PhoneIcon, VideoIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { DidAvatar } from "@/components/shared/DidAvatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useConnectionStore } from "@/stores/connection"
import { useContactStore } from "@/stores/contact"
import { useConversationStore } from "@/stores/conversation"

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

async function fetchProfile(
  nodeUrl: string,
  did: string,
  token?: string,
): Promise<ContactProfileData | null> {
  const res = await fetch(`${nodeUrl}/api/v1/clawnet/profile/${encodeURIComponent(did)}`, {
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(7_000),
  })
  if (!res.ok) return null
  const json = (await res.json()) as DataEnvelope<ContactProfileData>
  return json?.data ?? null
}

interface InfoRowProps {
  label: string
  value: string
  mono?: boolean
  copyable?: boolean
}

function InfoRow({ label, value, mono, copyable }: InfoRowProps) {
  const handleCopy = () => {
    if (!copyable) return
    void navigator.clipboard.writeText(value)
    toast.info("已复制到剪贴板")
  }
  return (
    <div
      className={`flex items-center justify-between gap-4 px-4 py-3 ${copyable ? "cursor-pointer hover:bg-accent" : ""}`}
      onClick={copyable ? handleCopy : undefined}
    >
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span
        className={`max-w-[60%] truncate text-right text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

interface ActionButtonProps {
  icon: React.ReactNode
  label: string
  color?: string
  disabled?: boolean
  onClick?: () => void
}

function ActionButton({ icon, label, color = "bg-primary", disabled, onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 ${disabled ? "opacity-40" : ""}`}
    >
      <span
        className={`flex size-[52px] items-center justify-center rounded-full text-white ${color} ${!disabled ? "hover:brightness-110 active:scale-95" : ""} transition-all`}
      >
        {icon}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </button>
  )
}

interface ContactInfoPanelProps {
  did: string
  onOpenChat: (conversationId: string) => void
  onContactRemoved: () => void
}

export function ContactInfoPanel({ did, onOpenChat, onContactRemoved }: ContactInfoPanelProps) {
  const { t } = useTranslation()
  const nodeUrl = useConnectionStore((state) => state.nodeUrl)
  const sessionToken = useConnectionStore((state) => state.sessionToken)
  const getEffectiveDisplayName = useContactStore((state) => state.getEffectiveDisplayName)
  const getEffectiveAvatarUrl = useContactStore((state) => state.getEffectiveAvatarUrl)
  const resolve = useContactStore((state) => state.resolve)
  const identity = useContactStore((state) => state.identitiesByDid[did])
  const identityLoading = useContactStore((state) => state.loadingByDid[did] ?? false)
  const fetchPeerProfile = useContactStore((state) => state.fetchPeerProfile)
  const peerProfile = useContactStore((state) => state.peerProfiles[did])
  const removeContact = useContactStore((state) => state.removeContact)
  const conversations = useConversationStore((state) => state.conversations)
  const setSelectedConversationId = useConversationStore((state) => state.setSelectedConversationId)
  const deleteConversation = useConversationStore((state) => state.deleteConversation)

  const [chainProfile, setChainProfile] = useState<ContactProfileData | null>(null)
  const [chainLoading, setChainLoading] = useState(false)
  const [removing, setRemoving] = useState(false)

  const displayName = getEffectiveDisplayName(did)
  const avatarUrl = getEffectiveAvatarUrl(did)
  const didTail = did.split(":").at(-1) ?? did
  const shortDid = `did:claw:${didTail.slice(0, 8)}…${didTail.slice(-6)}`

  useEffect(() => {
    void resolve(did)
    void fetchPeerProfile(did)
  }, [did, resolve, fetchPeerProfile])

  useEffect(() => {
    if (!nodeUrl) return
    let cancelled = false
    setChainLoading(true)
    void fetchProfile(nodeUrl, did, sessionToken || undefined)
      .then((data) => { if (!cancelled) setChainProfile(data) })
      .finally(() => { if (!cancelled) setChainLoading(false) })
    return () => { cancelled = true }
  }, [did, nodeUrl, sessionToken])

  const handleOpenChat = () => {
    const conv = conversations.find(
      (c) => c.peerDid === did || c.conversationId === `direct:${did}`,
    )
    if (conv) {
      setSelectedConversationId(conv.conversationId)
      onOpenChat(conv.conversationId)
    } else {
      toast.error("暂无会话，请先发送一条消息")
    }
  }

  const handleRemove = async () => {
    if (removing) return
    setRemoving(true)
    try {
      // delete the direct conversation first (purges envelopes too)
      const conv = conversations.find(
        (c) => c.peerDid === did || c.conversationId === `direct:${did}`,
      )
      if (conv) {
        await deleteConversation(conv.conversationId)
      }
      await removeContact(did)
      onContactRemoved()
    } catch {
      toast.error("删除联系人失败")
    } finally {
      setRemoving(false)
    }
  }

  const isActive = identity?.isActive ?? (chainProfile?.identity?.isActive)
  const address = chainProfile?.identity?.address
  const activeKey = chainProfile?.identity?.activeKey ?? identity?.publicKey

  return (
    <div className="flex h-full flex-col bg-background">
      <ScrollArea className="min-h-0 flex-1">
        {/* Hero block */}
        <div className="flex flex-col items-center pt-14 pb-6">
          <DidAvatar did={did} avatarUrl={avatarUrl} className="size-24 text-3xl" />
          <h1 className="mt-4 text-2xl font-bold text-foreground">{displayName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{shortDid}</p>
        </div>

        {/* Action buttons */}
        <div className="flex justify-center gap-8 pb-8">
          <ActionButton
            icon={<MessageCircleIcon className="size-6" />}
            label="消息"
            color="bg-primary"
            onClick={handleOpenChat}
          />
          <ActionButton
            icon={<PhoneIcon className="size-6" />}
            label="音频"
            color="bg-primary"
            disabled
          />
          <ActionButton
            icon={<VideoIcon className="size-6" />}
            label="视频"
            color="bg-primary"
            disabled
          />
          <ActionButton
            icon={<EllipsisIcon className="size-6" />}
            label="更多"
            color="bg-muted"
            disabled
          />
        </div>

        {/* Info card */}
        <div className="mx-4 mb-4 overflow-hidden rounded-xl bg-card divide-y divide-border">
          <InfoRow label="DID 地址" value={did} mono copyable />
          {peerProfile?.nodeUrl ? <InfoRow label="节点" value={peerProfile.nodeUrl} /> : null}
          {chainLoading || identityLoading ? (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted-foreground">链上信息</span>
              <Skeleton className="h-4 w-24" />
            </div>
          ) : (
            <>
              {address ? <InfoRow label="钱包地址" value={address} mono copyable /> : null}
              {activeKey ? <InfoRow label="公钥" value={activeKey} mono copyable /> : null}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">状态</span>
                {isActive == null ? (
                  <span className="text-sm text-muted-foreground">-</span>
                ) : (
                  <Badge variant={isActive ? "success" : "destructive"}>
                    {isActive ? "活跃" : "未激活"}
                  </Badge>
                )}
              </div>
            </>
          )}
        </div>

        {/* Delete button */}
        <div className="mx-4 mb-8">
          <button
            type="button"
            disabled={removing}
            onClick={() => void handleRemove()}
            className="w-full rounded-xl bg-card px-4 py-3 text-center text-sm font-medium text-destructive transition-colors hover:bg-accent disabled:opacity-50"
          >
            {removing ? "删除中…" : t("contact.remove")}
          </button>
        </div>
      </ScrollArea>
    </div>
  )
}
