import { useCallback, useEffect, useRef, useState } from "react"

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

interface ImageBubbleProps {
  align: "left" | "right"
  imageUrl?: string
  timestamp: number
  provisional?: boolean
  attachmentManifestHash?: string
  showTail?: boolean
}

/** Max retry attempts when the image fails to load (e.g. file hasn't arrived yet). */
const MAX_RETRIES = 8
/** Base delay in milliseconds — actual delay doubles each attempt (1 s → 2 s → 4 s → … capped at 30 s). */
const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 30_000

export function ImageBubble({
  imageUrl,
  provisional,
}: ImageBubbleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Clean up pending retry timer on unmount.
  useEffect(() => () => { clearTimeout(retryTimerRef.current) }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !imageUrl) {
      return
    }

    if (!("IntersectionObserver" in window)) {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      {
        rootMargin: "120px",
      },
    )

    observer.observe(container)
    return () => observer.disconnect()
  }, [imageUrl])

  // When the image fails to load, schedule a retry with exponential backoff.
  const handleError = useCallback(() => {
    if (!imageUrl) return
    // blob: URLs won't benefit from a retry — they're local.
    if (imageUrl.startsWith("blob:")) {
      setFailed(true)
      return
    }
    if (retryCount >= MAX_RETRIES) {
      setFailed(true)
      return
    }
    const delay = Math.min(BASE_DELAY_MS * 2 ** retryCount, MAX_DELAY_MS)
    retryTimerRef.current = setTimeout(() => {
      setRetryCount((c) => c + 1)
    }, delay)
  }, [imageUrl, retryCount])

  // Reset retry/loading state when imageUrl changes (e.g. sender switches from blob to http).
  useEffect(() => {
    setRetryCount(0)
    setFailed(false)
    setLoaded(false)
  }, [imageUrl])

  const shouldLoad = inView || !imageUrl

  if (!imageUrl) {
    return null
  }

  // Append a cache-buster on retries so the browser doesn't serve a cached 404.
  const src = retryCount > 0
    ? `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}_r=${retryCount}`
    : imageUrl

  return (
    <div
      ref={containerRef}
      className={provisional ? "opacity-60" : ""}
    >
      {shouldLoad ? (
        failed ? (
          <div className="flex h-48 w-[280px] items-center justify-center rounded-[4px] bg-muted text-xs text-muted-foreground">
            Image unavailable
          </div>
        ) : (
          <>
            {/* Spinner placeholder while image is loading */}
            {!loaded && (
              <div className="flex h-48 w-[280px] items-center justify-center rounded-[4px] bg-muted">
                <svg
                  className="h-8 w-8 animate-spin text-muted-foreground"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              </div>
            )}
            <Dialog>
              <DialogTrigger asChild>
                <img
                  src={src}
                  alt="image"
                  loading="lazy"
                  onLoad={() => setLoaded(true)}
                  onError={handleError}
                  className={loaded
                    ? "block max-h-72 max-w-[280px] cursor-zoom-in rounded-[4px] object-cover"
                    : "absolute h-0 w-0 opacity-0 overflow-hidden"}
                />
              </DialogTrigger>
              <DialogContent className="max-w-4xl bg-black/95 p-2" aria-describedby={undefined}>
                <DialogTitle className="sr-only">Image preview</DialogTitle>
                <img src={src} alt="image-full" className="max-h-[85vh] w-full rounded object-contain" />
              </DialogContent>
            </Dialog>
          </>
        )
      ) : (
        <div className="h-48 w-[280px]" />
      )}
    </div>
  )
}
