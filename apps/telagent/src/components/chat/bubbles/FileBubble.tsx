import { FileIcon, DownloadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { shortHash } from "@/components/chat/bubbles/payload-utils"
import { BubbleTail } from "@/components/chat/bubbles/BubbleTail"

interface FileBubbleProps {
  align: "left" | "right"
  filename: string
  timestamp: number
  onDownload?: () => void
  provisional?: boolean
  attachmentManifestHash?: string
  showTail?: boolean
}

export function FileBubble({
  align,
  filename,
  timestamp,
  onDownload,
  provisional,
  attachmentManifestHash,
  showTail = true,
}: FileBubbleProps) {
  const self = align === "right"
  return (
    <div className="relative w-fit">
      <div
        className={cn(
          "w-fit rounded-[18px] px-3 py-1.5",
          self
            ? "bg-[var(--chat-bubble-self)] text-[var(--chat-bubble-self-fg)]"
            : "bg-[var(--chat-bubble-peer)] text-[var(--chat-bubble-peer-fg)]",
          showTail && self && "rounded-br-[4px]",
          showTail && !self && "rounded-bl-[4px]",
          provisional ? "opacity-60" : "",
        )}
      >
          <div className="flex items-center gap-2">
            <FileIcon className="size-4 opacity-60" />
            <span className="max-w-56 truncate text-sm">{filename}</span>
            <Button variant="ghost" size="icon-xs" onClick={onDownload}>
              <DownloadIcon className="size-3.5" />
            </Button>
          </div>
          {attachmentManifestHash ? (
            <p className="mt-1 text-[10px] opacity-60">
              attachment: {shortHash(attachmentManifestHash, 8)}
            </p>
          ) : null}
          <p className="mt-1 text-[10px] opacity-60">
            {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
      </div>
      {showTail && <BubbleTail align={align} />}
    </div>
  )
}
