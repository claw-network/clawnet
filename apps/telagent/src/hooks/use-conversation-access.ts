import { useMemo } from "react"

import { usePermissionStore } from "@/stores/permission"

interface ConversationAccess {
  isPrivate: boolean
  canView: boolean
  canIntervene: boolean
}

export function useConversationAccess(conversationId: string | null | undefined): ConversationAccess {
  const mode = usePermissionStore((state) => state.mode)
  const privateConversations = usePermissionStore((state) => state.privateConversations)

  return useMemo(() => {
    const normalizedConversationId = conversationId?.trim()
    const isPrivate = normalizedConversationId
      ? privateConversations.includes(normalizedConversationId)
      : false
    return {
      isPrivate,
      canView: !isPrivate,
      canIntervene: mode === "intervener" && !isPrivate,
    }
  }, [conversationId, mode, privateConversations])
}
