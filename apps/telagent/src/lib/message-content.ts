function toHex(byte: number): string {
  return byte.toString(16).padStart(2, "0")
}

export function encodeUtf8Hex(value: string): string {
  const encoded = new TextEncoder().encode(value)
  let hex = "0x"
  for (const byte of encoded) {
    hex += toHex(byte)
  }
  return hex
}

export function decodeUtf8Hex(value: string): string | null {
  const normalized = value.trim()
  if (!/^0x[0-9a-fA-F]+$/.test(normalized)) {
    return null
  }
  const hexBody = normalized.slice(2)
  if (hexBody.length === 0 || hexBody.length % 2 !== 0) {
    return null
  }

  const bytes = new Uint8Array(hexBody.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    const start = index * 2
    const byte = Number.parseInt(hexBody.slice(start, start + 2), 16)
    if (!Number.isFinite(byte)) {
      return null
    }
    bytes[index] = byte
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
    if (!decoded) {
      return null
    }
    return decoded
  } catch {
    return null
  }
}

export function readableCiphertext(value: string): string {
  return decodeUtf8Hex(value) ?? value
}
