import { CrownIcon } from "lucide-react"
import { useEffect, useMemo } from "react"

import { DidAvatar } from "@/components/shared/DidAvatar"
import { useConversationStore } from "@/stores/conversation"
import { useGroupStore } from "@/stores/group"

interface PresenceItem {
  did: string
  displayName: string
  state: "online" | "offline"
}

function compactDid(did: string): string {
  if (did.length <= 16) {
    return did
  }
  return `${did.slice(0, 10)}...${did.slice(-4)}`
}

export function MemberPresencePanel() {
  const conversations = useConversationStore((state) => state.conversations)
  const selectedConversationId = useConversationStore((state) => state.selectedConversationId)

  const loadMembers = useGroupStore((state) => state.loadMembers)
  const membersByGroupId = useGroupStore((state) => state.membersByGroupId)

  const activeConversation = useMemo(
    () => conversations.find((item) => item.conversationId === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  )

  const activeGroupId = useMemo(() => {
    if (!activeConversation || activeConversation.conversationType !== "group") {
      return null
    }
    return activeConversation.groupId
      ?? (activeConversation.conversationId.startsWith("group:") ? activeConversation.conversationId.slice(6) : null)
  }, [activeConversation])

  useEffect(() => {
    if (!activeGroupId) {
      return
    }
    void loadMembers(activeGroupId, {
      view: "all",
      page: 1,
      perPage: 100,
    })
  }, [activeGroupId, loadMembers])

  const members = useMemo<PresenceItem[]>(() => {
    if (!activeConversation) {
      return []
    }

    if (activeConversation.conversationType === "group") {
      const rows = activeGroupId ? (membersByGroupId[activeGroupId] ?? []) : []
      if (rows.length > 0) {
        return rows.map((row, index) => ({
          did: row.did,
          displayName: compactDid(row.did),
          state: index === 0 ? "online" : "offline",
        }))
      }
    }

    if (activeConversation.peerDid) {
      return [
        {
          did: activeConversation.peerDid,
          displayName: compactDid(activeConversation.peerDid),
          state: "online",
        },
      ]
    }

    return []
  }, [activeConversation, activeGroupId, membersByGroupId])

  const online = members.filter((item) => item.state === "online")
  const offline = members.filter((item) => item.state === "offline")

  return (
    <aside className="hidden w-[240px] border-l border-border bg-card text-foreground xl:block">
      <div className="h-full overflow-y-auto px-3 py-5">
        <section>
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Online - {online.length}
          </h3>
          <div className="space-y-2">
            {online.map((member) => (
              <div key={member.did} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
                <div className="relative">
                  <DidAvatar did={member.did} className="size-8" />
                  <span className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-card bg-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {member.displayName}
                    <CrownIcon className="ml-1 inline size-3 text-amber-400" />
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Offline - {offline.length}
          </h3>
          <div className="space-y-2">
            {offline.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">No offline members</p>
            ) : (
              offline.map((member) => (
                <div key={member.did} className="flex items-center gap-2 rounded-md px-2 py-1.5 opacity-70 hover:bg-accent">
                  <DidAvatar did={member.did} className="size-8 grayscale" />
                  <p className="truncate text-sm">{member.displayName}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </aside>
  )
}
