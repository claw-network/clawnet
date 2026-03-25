export function parsePayload<T>(raw: string): T | null {
  if (!raw) {
    return null
  }

  const trimmed = raw.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null
  }

  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}

export function shortHash(value: string | undefined, size = 6): string {
  if (!value) {
    return "-"
  }
  if (value.length <= size * 2) {
    return value
  }
  return `${value.slice(0, size)}...${value.slice(-size)}`
}

export function formatAmount(value: number | string | undefined, currency = "CLAW"): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value.toLocaleString()} ${currency}`
  }
  if (typeof value === "string" && value.trim()) {
    return `${value} ${currency}`
  }
  return `0 ${currency}`
}
