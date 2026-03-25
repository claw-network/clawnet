import { ConversationList } from "@/components/chat/ConversationList"
import { useIsMobile } from "@/hooks/use-mobile"
import { ChatViewPage } from "@/pages/chat-view"

export function ChatPage() {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <ConversationList />
  }

  return <ChatViewPage />
}
