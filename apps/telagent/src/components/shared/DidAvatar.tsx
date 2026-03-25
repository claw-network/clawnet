import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useConnectionStore } from "@/stores/connection"

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function colorForDid(did: string): string {
  const hue = hashString(did) % 360
  return `hsl(${hue} 68% 45%)`
}

function initialsFromDid(did: string): string {
  if (!did) {
    return "AG"
  }
  const tail = did.split(":").at(-1) ?? did
  return tail.slice(0, 2).toUpperCase()
}

interface DidAvatarProps {
  did: string
  avatarUrl?: string
  /** Override base URL for resolving relative avatar paths (used before connection is established) */
  baseUrl?: string
  className?: string
}

export function DidAvatar({ did, avatarUrl, baseUrl, className }: DidAvatarProps) {
  const nodeUrl = useConnectionStore((state) => state.nodeUrl)

  // Resolve relative paths (e.g. /api/v1/profile/avatar) against the node URL
  const base = baseUrl || nodeUrl
  const resolvedUrl =
    avatarUrl && avatarUrl.startsWith("/") && base
      ? `${base.replace(/\/$/, "")}${avatarUrl}`
      : avatarUrl

  return (
    <Avatar className={cn("size-9", className)}>
      {resolvedUrl && (
        <AvatarImage
          src={resolvedUrl}
          alt={did}
        />
      )}
      <AvatarFallback style={{ backgroundColor: colorForDid(did), color: "white" }}>
        {initialsFromDid(did)}
      </AvatarFallback>
    </Avatar>
  )
}

