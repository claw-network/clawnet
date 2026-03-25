import { TelagentSdkError } from "@/lib/telagent-client"

export interface ParsedApiError {
  title: string
  detail: string
  status?: number
  code?: string
}

export function parseApiError(error: unknown, fallback = "Request failed"): ParsedApiError {
  if (error instanceof TelagentSdkError) {
    const detail = error.problem.detail ?? error.problem.title
    return {
      title: error.problem.title,
      detail,
      status: error.problem.status,
      code: error.problem.code,
    }
  }

  if (error instanceof Error) {
    return {
      title: "Error",
      detail: error.message,
    }
  }

  return {
    title: "Error",
    detail: fallback,
  }
}

export function formatApiError(error: unknown, fallback = "Request failed"): string {
  const parsed = parseApiError(error, fallback)
  if (parsed.code) {
    return `[${parsed.code}] ${parsed.detail}`
  }
  return parsed.detail
}

export function isLikelyNetworkError(error: unknown): boolean {
  if (error instanceof TelagentSdkError) {
    return false
  }

  if (error instanceof TypeError) {
    return true
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase()
    return (
      lower.includes("failed to fetch")
      || lower.includes("network")
      || lower.includes("fetch failed")
      || lower.includes("timeout")
      || lower.includes("offline")
      || lower.includes("unreachable")
    )
  }

  return false
}
