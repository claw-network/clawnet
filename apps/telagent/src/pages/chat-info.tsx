import { ArrowLeftIcon } from "lucide-react"
import { useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { ConversationDetailPanel } from "@/components/chat/ConversationDetailPanel"
import { Button } from "@/components/ui/button"
import { useConversationStore } from "@/stores/conversation"

export function ChatInfoPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const params = useParams<{ conversationId: string }>()
  const setSelectedConversationId = useConversationStore((state) => state.setSelectedConversationId)

  useEffect(() => {
    if (!params.conversationId) {
      return
    }
    setSelectedConversationId(params.conversationId)
  }, [params.conversationId, setSelectedConversationId])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate(-1)}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <h1 className="text-sm font-medium">{t("details.title")}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ConversationDetailPanel conversationId={params.conversationId ?? null} />
      </div>
    </div>
  )
}
