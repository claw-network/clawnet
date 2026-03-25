import {
  BellIcon,
  HashIcon,
  HelpCircleIcon,
  PinIcon,
  SearchIcon,
  Users2Icon,
} from "lucide-react"

import { ContactActions } from "@/components/contact/ContactActions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ConversationSummary } from "@/types/webapp"

interface ChatHeaderProps {
  conversation: ConversationSummary | null
  onOpenInfo: () => void
}

export function ChatHeader({ conversation, onOpenInfo }: ChatHeaderProps) {
  if (!conversation) {
    return (
      <div className="flex h-12 items-center justify-between border-b border-border px-4 text-muted-foreground">
        <span className="text-sm">Select a conversation</span>
      </div>
    )
  }

  return (
    <div className="flex h-12 items-center justify-between border-b border-border px-4 text-foreground shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <HashIcon className="size-5 text-muted-foreground" />
        <p className="truncate text-[21px] font-semibold leading-none">{conversation.displayName}</p>
        <span className="mx-1 h-5 w-px bg-border" />
        <p className="truncate text-sm text-muted-foreground">Welcome to {conversation.displayName}</p>
      </div>

      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:bg-accent">
          <BellIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:bg-accent">
          <PinIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:bg-accent" onClick={onOpenInfo}>
          <Users2Icon className="size-4" />
        </Button>
        {conversation.conversationType === "direct" ? (
          <ContactActions conversationId={conversation.conversationId} />
        ) : null}
        <div className="relative ml-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            readOnly
            value="Search"
            className="h-7 w-[180px] pr-8 text-xs"
          />
        </div>
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:bg-accent">
          <HelpCircleIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}
