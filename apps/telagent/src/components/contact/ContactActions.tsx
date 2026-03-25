import { MessageSquareIcon, Trash2Icon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { useGuardedAction } from "@/hooks/use-guarded-action"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useConversationStore } from "@/stores/conversation"
import { useMessageStore } from "@/stores/message"
import { useContactStore } from "@/stores/contact"

interface ContactActionsProps {
  conversationId: string
}

export function ContactActions({ conversationId }: ContactActionsProps) {
  const navigate = useNavigate()
  const { canExecute } = useGuardedAction("manage_contacts")
  const conversations = useConversationStore((state) => state.conversations)
  const deleteConversation = useConversationStore((state) => state.deleteConversation)
  const removeMessageConversation = useMessageStore((state) => state.removeConversation)
  const removeContact = useContactStore((state) => state.removeContact)

  if (!canExecute) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          Actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => {
            navigate(`/chat/${encodeURIComponent(conversationId)}`)
          }}
        >
          <MessageSquareIcon className="mr-2 size-3.5" />
          Open chat
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive"
          onClick={async () => {
            const conversation = conversations.find((c) => c.conversationId === conversationId)
            // peerDid may be absent on envelope-derived conversations; derive from conversationId format
            const peerDid =
              conversation?.peerDid ??
              (conversationId.startsWith("direct:") ? conversationId.slice("direct:".length) : undefined)
            try {
              await Promise.all([
                peerDid ? removeContact(peerDid) : Promise.resolve(),
                deleteConversation(conversationId),
              ])
            } catch {
              toast.error("Failed to remove contact")
              return
            }
            removeMessageConversation(conversationId)
            toast.success("Contact removed")
            navigate("/chat")
          }}
        >
          <Trash2Icon className="mr-2 size-3.5" />
          Remove contact
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
