import { LockIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { DidAvatar } from "@/components/shared/DidAvatar"
import type { ConversationSummary } from "@/types/webapp"

interface ConversationItemProps {
  conversation: ConversationSummary
  selected: boolean
  onSelect: (conversationId: string) => void
}

function formatTime(timestamp?: number): string {
  if (!timestamp) {
    return ""
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ConversationItem({ conversation, selected, onSelect }: ConversationItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.conversationId)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
        selected ? "bg-accent" : "hover:bg-accent",
      )}
    >
      <DidAvatar did={conversation.peerDid ?? conversation.groupId ?? conversation.conversationId} avatarUrl={conversation.avatarUrl ?? undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{conversation.displayName}</span>
          {conversation.private ? <LockIcon className="size-3.5 text-muted-foreground" /> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {conversation.private ? "••••••" : conversation.lastMessagePreview ?? ""}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-[10px] text-muted-foreground">{formatTime(conversation.lastMessageAtMs)}</span>
        {conversation.unreadCount > 0 && !conversation.private ? (
          <Badge className="rounded-full px-1.5 py-0 text-[10px] leading-4">{conversation.unreadCount}</Badge>
        ) : null}
      </div>
    </button>
  )
}
