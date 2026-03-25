import type { SessionOperationScope } from "@/lib/telagent-client"
import { useCallback } from "react"

import { useSessionStore } from "@/stores/session"

interface SessionGuardOptions {
  requiredScope?: SessionOperationScope[]
}

export function useSessionGuard() {
  const requestUnlock = useSessionStore((state) => state.requestUnlock)

  const ensureSession = useCallback(
    async (requiredScope?: SessionOperationScope[]) => {
      return requestUnlock(requiredScope)
    },
    [requestUnlock],
  )

  const withSession = useCallback(
    async <T>(operation: (sessionToken: string) => Promise<T>, options?: SessionGuardOptions): Promise<T> => {
      const sessionToken = await ensureSession(options?.requiredScope)
      return operation(sessionToken)
    },
    [ensureSession],
  )

  return {
    ensureSession,
    withSession,
  }
}
