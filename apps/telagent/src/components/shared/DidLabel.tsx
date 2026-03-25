import { CheckIcon, CopyIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface DidLabelProps {
  did: string
  className?: string
  copyable?: boolean
}

function compactDid(did: string): string {
  if (did.length <= 18) {
    return did
  }
  return `${did.slice(0, 12)}...${did.slice(-6)}`
}

export function DidLabel({ did, className, copyable = true }: DidLabelProps) {
  const normalizedDid = did.trim()
  const [copied, setCopied] = useState(false)
  const shortenedDid = useMemo(() => compactDid(normalizedDid), [normalizedDid])

  const copyDid = async () => {
    if (!copyable || !normalizedDid || typeof navigator === "undefined" || !navigator.clipboard) {
      return
    }
    try {
      await navigator.clipboard.writeText(normalizedDid)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void copyDid()}
            disabled={!copyable}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors",
              copyable ? "hover:bg-accent hover:text-foreground" : "cursor-default",
              className,
            )}
          >
            <span className="font-mono">{shortenedDid}</span>
            {copyable ? (
              copied ? <CheckIcon className="size-3 text-emerald-400" /> : <CopyIcon className="size-3" />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          <span className="font-mono">{normalizedDid}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
