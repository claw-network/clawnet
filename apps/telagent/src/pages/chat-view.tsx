import { useEffect, useMemo, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { ChatHeader } from "@/components/chat/ChatHeader"
import { MessageInput } from "@/components/chat/MessageInput"
import { MessageList } from "@/components/chat/MessageList"
import { PrivacyOverlay } from "@/components/chat/PrivacyOverlay"
import { Button } from "@/components/ui/button"
import { useConversationAccess } from "@/hooks/use-conversation-access"
import { useConversationStore } from "@/stores/conversation"
import { useMessageStore } from "@/stores/message"
import { useUIStore } from "@/stores/ui"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMobileKeyboardInset } from "@/hooks/use-mobile-keyboard-inset"

export function ChatViewPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const params = useParams<{ conversationId: string }>()
  const touchStartRef = useRef<{ x: number; y: number; at: number } | null>(null)

  const selectedConversationId = useConversationStore((state) => state.selectedConversationId)
  const setSelectedConversationId = useConversationStore((state) => state.setSelectedConversationId)
  const markRead = useConversationStore((state) => state.markRead)
  const conversations = useConversationStore((state) => state.conversations)
  const messagesByConversation = useMessageStore((state) => state.messagesByConversation)
  const setDetailPanelOpen = useUIStore((state) => state.setDetailPanelOpen)

  useEffect(() => {
    if (params.conversationId) {
      setSelectedConversationId(params.conversationId)
      markRead(params.conversationId)
    }
  }, [markRead, params.conversationId, setSelectedConversationId])

  const activeConversationId = params.conversationId ?? selectedConversationId
  const conversation = useMemo(
    () => conversations.find((item) => item.conversationId === activeConversationId) ?? null,
    [activeConversationId, conversations],
  )
  const messages = activeConversationId ? (messagesByConversation[activeConversationId] ?? []) : []
  const access = useConversationAccess(activeConversationId)
  const isPrivate = access.isPrivate
  const keyboardInset = useMobileKeyboardInset(isMobile)

  const openInfo = () => {
    if (!activeConversationId) {
      return
    }
    if (isMobile) {
      navigate(`/chat/${encodeURIComponent(activeConversationId)}/info`)
      return
    }
    setDetailPanelOpen(true)
  }

  const onTouchStart: React.TouchEventHandler<HTMLDivElement> = (event) => {
    if (!isMobile || !params.conversationId) {
      return
    }
    const touch = event.changedTouches[0]
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      at: Date.now(),
    }
  }

  const onTouchEnd: React.TouchEventHandler<HTMLDivElement> = (event) => {
    if (!isMobile || !params.conversationId) {
      return
    }

    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start) {
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = Math.abs(touch.clientY - start.y)
    const elapsed = Date.now() - start.at
    if (deltaX > 90 && deltaY < 64 && elapsed < 700) {
      navigate("/chat")
    }
  }

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <h2 className="text-lg font-semibold">{t("chat.emptyTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("chat.emptyDescription")}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        paddingBottom: keyboardInset > 0 ? `${keyboardInset}px` : undefined,
      }}
    >
      <ChatHeader conversation={conversation} onOpenInfo={openInfo} />
      <div className="relative min-h-0 flex-1 pt-2">
        <MessageList messages={messages} />
        {isPrivate ? <PrivacyOverlay /> : null}
      </div>
      {isPrivate ? (
        <div className="border-t p-3">
          <Button variant="secondary" disabled className="w-full">
            {t("chat.private")}
          </Button>
        </div>
      ) : (
        <MessageInput />
      )}
    </div>
  )
}
