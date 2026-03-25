import { useEffect, useState } from "react"

export function useMobileKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    if (!enabled || !window.visualViewport) {
      setInset(0)
      return undefined
    }

    const viewport = window.visualViewport

    const updateInset = () => {
      const nextInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      setInset(nextInset)
    }

    updateInset()
    viewport.addEventListener("resize", updateInset)
    viewport.addEventListener("scroll", updateInset)

    return () => {
      viewport.removeEventListener("resize", updateInset)
      viewport.removeEventListener("scroll", updateInset)
    }
  }, [enabled])

  return inset
}
