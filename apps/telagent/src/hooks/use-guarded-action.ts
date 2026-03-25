import { useMemo } from "react"

import { usePermissionStore } from "@/stores/permission"
import type { InterventionScope } from "@/types/webapp"

interface GuardedActionResult {
  canExecute: boolean
  reason: string | null
}

export function useGuardedAction(scope: InterventionScope): GuardedActionResult {
  const mode = usePermissionStore((state) => state.mode)
  const scopes = usePermissionStore((state) => state.interventionScopes)

  return useMemo(() => {
    if (mode !== "intervener") {
      return {
        canExecute: false,
        reason: "You are in observer mode",
      }
    }
    if (!scopes.includes(scope)) {
      return {
        canExecute: false,
        reason: `Missing ${scope} permission`,
      }
    }
    return {
      canExecute: true,
      reason: null,
    }
  }, [mode, scope, scopes])
}
