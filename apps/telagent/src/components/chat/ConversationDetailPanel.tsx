import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { ContactDetail } from "@/components/contact/ContactDetail"
import { GroupDetail } from "@/components/group/GroupDetail"
import { useConversationStore } from "@/stores/conversation"

interface ConversationDetailPanelProps {
  conversationId?: string | null
}

function extractDidFromConversationId(conversationId: string): string | null {
  const matches = conversationId.match(/did:claw:[A-Za-z0-9._:-]+/g)
  if (!matches || matches.length === 0) {
    return null
  }
  return matches[0] ?? null
}

function normalizeGroupId(raw?: string, fallbackConversationId?: string): string | null {
  if (raw && raw.trim()) {
    return raw.trim()
  }
  if (!fallbackConversationId) {
    return null
  }
  return fallbackConversationId.startsWith("group:")
    ? fallbackConversationId.slice("group:".length)
    : fallbackConversationId
}

export function ConversationDetailPanel({ conversationId }: ConversationDetailPanelProps) {
  const { t } = useTranslation()
  const selectedConversationId = useConversationStore((state) => state.selectedConversationId)
  const conversations = useConversationStore((state) => state.conversations)
  const targetConversationId = conversationId ?? selectedConversationId

  const conversation = useMemo(
    () => conversations.find((item) => item.conversationId === targetConversationId) ?? null,
    [conversations, targetConversationId],
  )

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("details.selectConversation")}</p>
      </div>
    )
  }

  if (conversation.conversationType === "group") {
    const groupId = normalizeGroupId(conversation.groupId, conversation.conversationId)
    if (!groupId) {
      return (
        <div className="p-4">
          <p className="text-sm text-muted-foreground">{t("details.noData")}</p>
        </div>
      )
    }
    return <GroupDetail groupId={groupId} />
  }

  const did = conversation.peerDid ?? extractDidFromConversationId(conversation.conversationId)
  if (!did) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">{t("details.noData")}</p>
      </div>
    )
  }
  return <ContactDetail did={did} />
}
