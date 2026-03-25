import { cn } from "@/lib/utils"
import { shortHash } from "@/components/chat/bubbles/payload-utils"
import { BubbleTail } from "@/components/chat/bubbles/BubbleTail"

interface TextBubbleProps {
  align: "left" | "right"
  text: string
  timestamp: number
  provisional?: boolean
  attachmentManifestHash?: string
  showTail?: boolean
}

export function TextBubble({ align, text, timestamp, provisional, attachmentManifestHash, showTail = true }: TextBubbleProps) {
  const self = align === "right"
  return (
    <div className="relative w-fit">
      <div
        className={cn(
          "w-fit rounded-[18px] px-3 py-1.5 text-[16px] leading-[21px]",
          self
            ? "bg-[var(--chat-bubble-self)] text-[var(--chat-bubble-self-fg)]"
            : "bg-[var(--chat-bubble-peer)] text-[var(--chat-bubble-peer-fg)]",
          showTail && self && "rounded-br-[4px]",
          showTail && !self && "rounded-bl-[4px]",
          provisional ? "opacity-60" : "",
        )}
      >
        <p className="break-words whitespace-pre-wrap">{text}</p>
        {attachmentManifestHash ? (
          <p className={cn("mt-1 text-[10px]", self ? "text-white/60" : "text-black/40 dark:text-white/40")}>
            attachment: {shortHash(attachmentManifestHash, 8)}
          </p>
        ) : null}
      </div>
      {showTail && <BubbleTail align={align} />}
    </div>
  )
}
