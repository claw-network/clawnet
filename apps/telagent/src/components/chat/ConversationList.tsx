import { SearchIcon } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { DidAvatar } from "@/components/shared/DidAvatar"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useConversationStore } from "@/stores/conversation"
import { ConversationItem } from "@/components/chat/ConversationItem"
import { useIsMobile } from "@/hooks/use-mobile"
import { CreateGroupDialog } from "@/components/group/CreateGroupDialog"
import { EmptyState } from "@/components/shared/EmptyState"

export function ConversationList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const conversations = useConversationStore((state) => state.conversations)
  const selectedConversationId = useConversationStore((state) => state.selectedConversationId)
  const searchQuery = useConversationStore((state) => state.searchQuery)
  const setSearchQuery = useConversationStore((state) => state.setSearchQuery)
  const setSelectedConversationId = useConversationStore((state) => state.setSelectedConversationId)

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return conversations
    return conversations.filter(
      (c) =>
        c.displayName.toLowerCase().includes(query) ||
        c.conversationId.toLowerCase().includes(query),
    )
  }, [conversations, searchQuery])

  const isSearching = searchQuery.trim().length > 0

  const handleSelect = (conversationId: string) => {
    setSelectedConversationId(conversationId)
    if (isMobile) {
      navigate(`/chat/${encodeURIComponent(conversationId)}`)
    }
  }

  if (isMobile) {
    return (
      <div className="flex h-full flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("chat.title")}</h2>
          <CreateGroupDialog />
        </div>
        <Input
          value={searchQuery}
          placeholder={t("chat.search")}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        <ScrollArea className="min-h-0 flex-1 rounded-lg border bg-card/50">
          <div className="space-y-1 p-2">
            {filtered.length === 0 ? (
              <EmptyState
                title={isSearching ? t("chat.noSearchResults") : t("chat.noConversations")}
                description={isSearching ? t("chat.noSearchResultsHint") : t("chat.emptyDescription")}
              />
            ) : (
              filtered.map((conversation) => (
                <ConversationItem
                  key={conversation.conversationId}
                  conversation={conversation}
                  selected={conversation.conversationId === selectedConversationId}
                  onSelect={handleSelect}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col text-foreground">
      <div className="border-b border-border px-3 py-3 shadow-sm">
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.8}
          />
          <Input
            value={searchQuery}
            placeholder={t("chat.search")}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-9 pl-9 text-sm"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="overflow-hidden pb-4">
          {filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {isSearching ? "没有匹配的会话" : "暂无会话"}
            </p>
          ) : (
            filtered.map((conversation) => (
              <button
                type="button"
                key={conversation.conversationId}
                onClick={() => handleSelect(conversation.conversationId)}
                className={`mb-0.5 flex min-w-0 w-full items-center gap-3 overflow-hidden px-2 py-2 text-left transition-colors ${
                  conversation.conversationId === selectedConversationId
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <DidAvatar
                  did={conversation.peerDid ?? conversation.groupId ?? conversation.conversationId}
                  avatarUrl={conversation.avatarUrl ?? undefined}
                  className="size-10 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {conversation.displayName}
                    </span>
                    {conversation.lastMessageAtMs ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {new Date(conversation.lastMessageAtMs).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground" style={{ maxWidth: 172 }}>
                    {conversation.private ? "••••••" : (conversation.lastMessagePreview ?? "")}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
