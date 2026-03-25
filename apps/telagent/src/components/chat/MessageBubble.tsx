import { memo } from "react"
import type {
  EscrowCreatedPayload,
  EscrowReleasedPayload,
  IdentityCardPayload,
  MilestoneUpdatePayload,
  ReviewCardPayload,
  TaskBidPayload,
  TaskListingPayload,
  TransferReceiptPayload,
  TransferRequestPayload,
} from "@claw-network/client/protocol"

import { ControlNotice } from "@/components/chat/bubbles/ControlNotice"
import { EscrowCreatedCard } from "@/components/chat/bubbles/EscrowCreatedCard"
import { EscrowReleasedCard } from "@/components/chat/bubbles/EscrowReleasedCard"
import { FileBubble } from "@/components/chat/bubbles/FileBubble"
import { IdentityCard } from "@/components/chat/bubbles/IdentityCard"
import { ImageBubble } from "@/components/chat/bubbles/ImageBubble"
import { MilestoneUpdateCard } from "@/components/chat/bubbles/MilestoneUpdateCard"
import { ReviewCard } from "@/components/chat/bubbles/ReviewCard"
import { TaskBidCard } from "@/components/chat/bubbles/TaskBidCard"
import { TaskListingCard } from "@/components/chat/bubbles/TaskListingCard"
import { TextBubble } from "@/components/chat/bubbles/TextBubble"
import { TransferReceiptCard } from "@/components/chat/bubbles/TransferReceiptCard"
import { TransferRequestCard } from "@/components/chat/bubbles/TransferRequestCard"
import { parsePayload } from "@/components/chat/bubbles/payload-utils"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { readableCiphertext } from "@/lib/message-content"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { usePermissionStore } from "@/stores/permission"
import { useConnectionStore } from "@/stores/connection"
import type { MessageWithStatus } from "@/types/webapp"

interface MessageBubbleProps {
  message: MessageWithStatus
  align: "left" | "right"
  onRetry?: (message: MessageWithStatus) => void
  showTail?: boolean
}

function isProbableImageUrl(value: string): boolean {
  return /^https?:\/\//.test(value) || /^data:image\//.test(value) || /^blob:/.test(value)
}

/** Resolve a "local:<objectKey>" URI to the TelagentNode URL.
 * Other URL schemes are returned unchanged.
 * Backwards-compatible: existing messages with https:// URLs work as-is. */
function resolveAttachmentUrl(value: string, nodeUrl: string): string {
  if (value.startsWith('local:')) {
    const objectKey = value.slice(6)
    return `${nodeUrl.replace(/\/$/, '')}/api/v1/attachments/${encodeURIComponent(objectKey)}`
  }
  return value
}

function alignedCard(align: "left" | "right", content: import("react").ReactNode) {
  return (
    <div className="w-fit">{content}</div>
  )
}

function deliveryState(
  align: "left" | "right",
  message: MessageWithStatus,
  onRetry?: (message: MessageWithStatus) => void,
) {
  if (message.deliveryStatus === "pending") {
    return (
      <div className={cn("mt-1 flex text-[11px] text-muted-foreground", align === "right" ? "justify-end" : "justify-start")}>
        <span className="inline-flex items-center gap-1">
          <Spinner className="size-3" />
          Pending delivery...
        </span>
      </div>
    )
  }

  if (message.deliveryStatus === "failed") {
    return (
      <div className={cn("mt-1 flex items-center gap-2 text-[11px] text-destructive", align === "right" ? "justify-end" : "justify-start")}>
        <span>Send failed</span>
        <Button type="button" size="sm" variant="outline" onClick={() => onRetry?.(message)}>
          Retry
        </Button>
      </div>
    )
  }

  return null
}

export function MessageBubble({ message, align, onRetry, showTail = true }: MessageBubbleProps) {
  const { t } = useTranslation()
  const mode = usePermissionStore((state) => state.mode)
  const nodeUrl = useConnectionStore((state) => state.nodeUrl)
  const readableText = message.clientDisplayText ?? readableCiphertext(message.ciphertext)
  let content: import("react").ReactNode

  if (message.contentType === "control") {
    content = <ControlNotice text="Control message" />
  } else if (message.contentType === "image") {
    const raw = message.clientDisplayText ?? readableText
    const candidate = resolveAttachmentUrl(raw, nodeUrl)
    content = (
      <ImageBubble
        align={align}
        imageUrl={isProbableImageUrl(candidate) ? candidate : undefined}
        timestamp={message.sentAtMs}
        provisional={message.provisional}
        attachmentManifestHash={message.attachmentManifestHash}
        showTail={showTail}
      />
    )
  } else if (message.contentType === "file") {
    // Resolve the display filename.
    // - Sender side: clientDisplayText holds the original file.name from the OS.
    // - Receiver side: ciphertext decodes to "local:attachments/{ts}-{uuid}-{safeFilename}".
    //   Extract the safeFilename portion so we show something human-readable.
    const rawFile = message.clientDisplayText ?? readableText
    let defaultName: string
    if (rawFile?.startsWith('local:')) {
      // objectKey format: "attachments/{timestamp}-{8hex}-{4hex}-{4hex}-{4hex}-{12hex}-{filename}"
      // Split by "-": ["attachments/{ts}", uuid4 parts (×5), ...filename parts]
      const parts = rawFile.slice(6).split('-')
      defaultName = parts.length > 6 ? parts.slice(6).join('-') : (parts.at(-1) ?? 'file')
    } else if (rawFile && !rawFile.startsWith('0x')) {
      defaultName = rawFile
    } else {
      defaultName = message.attachmentManifestHash
        ? `file-${message.attachmentManifestHash.slice(0, 8)}`
        : 'attachment.bin'
    }
    content = (
      <FileBubble
        align={align}
        filename={defaultName}
        timestamp={message.sentAtMs}
        provisional={message.provisional}
        attachmentManifestHash={message.attachmentManifestHash}
        showTail={showTail}
      />
    )
  } else if (message.contentType === "text") {
    content = (
      <TextBubble
        align={align}
        text={readableText}
        timestamp={message.sentAtMs}
        provisional={message.provisional}
        attachmentManifestHash={message.attachmentManifestHash}
        showTail={showTail}
      />
    )
  } else if (message.contentType === "telagent/identity-card") {
    const payload = parsePayload<IdentityCardPayload>(readableText)
    content = payload ? alignedCard(align, <IdentityCard payload={payload} />) : null
  } else if (message.contentType === "telagent/transfer-request") {
    const payload = parsePayload<TransferRequestPayload>(readableText)
    content = payload ? alignedCard(align, <TransferRequestCard payload={payload} />) : null
  } else if (message.contentType === "telagent/transfer-receipt") {
    const payload = parsePayload<TransferReceiptPayload>(readableText)
    content = payload ? alignedCard(align, <TransferReceiptCard payload={payload} />) : null
  } else if (message.contentType === "telagent/task-listing") {
    const payload = parsePayload<TaskListingPayload>(readableText)
    content = payload ? alignedCard(align, <TaskListingCard payload={payload} />) : null
  } else if (message.contentType === "telagent/task-bid") {
    const payload = parsePayload<TaskBidPayload>(readableText)
    content = payload ? alignedCard(align, <TaskBidCard payload={payload} />) : null
  } else if (message.contentType === "telagent/escrow-created") {
    const payload = parsePayload<EscrowCreatedPayload>(readableText)
    content = payload ? alignedCard(align, <EscrowCreatedCard payload={payload} />) : null
  } else if (message.contentType === "telagent/escrow-released") {
    const payload = parsePayload<EscrowReleasedPayload>(readableText)
    content = payload ? alignedCard(align, <EscrowReleasedCard payload={payload} />) : null
  } else if (message.contentType === "telagent/milestone-update") {
    const payload = parsePayload<MilestoneUpdatePayload>(readableText)
    content = payload ? alignedCard(align, <MilestoneUpdateCard payload={payload} />) : null
  } else if (message.contentType === "telagent/review-card") {
    const payload = parsePayload<ReviewCardPayload>(readableText)
    content = payload ? alignedCard(align, <ReviewCard payload={payload} />) : null
  } else {
    content = (
      <TextBubble
        align={align}
        text={`[${message.contentType}] ${readableText ? readableText.slice(0, 64) : ""}`}
        timestamp={message.sentAtMs}
        provisional={message.provisional}
        attachmentManifestHash={message.attachmentManifestHash}
        showTail={showTail}
      />
    )
  }

  const renderedContent = content ?? (
    <TextBubble
      align={align}
      text={`[${message.contentType}] ${readableText ? readableText.slice(0, 64) : ""}`}
      timestamp={message.sentAtMs}
      provisional={message.provisional}
      attachmentManifestHash={message.attachmentManifestHash}
      showTail={showTail}
    />
  )

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(readableText)
      toast.success(t("chat.copied"))
    } catch {
      toast.error(t("chat.copyFailed"))
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="w-fit">
          {renderedContent}
          {deliveryState(align, message, onRetry)}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => void copyMessage()}>
          {t("chat.copy")}
        </ContextMenuItem>
        {mode === "intervener" && message.deliveryStatus === "failed" && onRetry ? (
          <ContextMenuItem onClick={() => onRetry(message)}>
            {t("common.retry")}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function areMessagePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  return (
    prev.showTail === next.showTail
    && prev.align === next.align
    && prev.message.envelopeId === next.message.envelopeId
    && prev.message.deliveryStatus === next.message.deliveryStatus
    && prev.message.lastError === next.message.lastError
    && prev.message.provisional === next.message.provisional
    && prev.message.ciphertext === next.message.ciphertext
    && prev.message.clientDisplayText === next.message.clientDisplayText
    && prev.message.attachmentManifestHash === next.message.attachmentManifestHash
    && prev.message.contentType === next.message.contentType
    && prev.message.sentAtMs === next.message.sentAtMs
  )
}

export const MemoMessageBubble = memo(MessageBubble, areMessagePropsEqual)
