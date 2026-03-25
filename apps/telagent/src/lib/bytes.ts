function randomByte(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(1)
    crypto.getRandomValues(bytes)
    return bytes[0] ?? 0
  }
  return Math.floor(Math.random() * 256)
}

export function randomBytes32Hex(): string {
  let hex = "0x"
  for (let index = 0; index < 32; index += 1) {
    hex += randomByte().toString(16).padStart(2, "0")
  }
  return hex
}
