import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Detect mkcert certificates for local HTTPS
const certPath = process.env.TELAGENT_TLS_CERT || path.join(homedir(), ".telagent", "tls", "cert.pem")
const keyPath = process.env.TELAGENT_TLS_KEY || path.join(homedir(), ".telagent", "tls", "key.pem")
const httpsConfig = existsSync(certPath) && existsSync(keyPath)
  ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
  : undefined

const tlsPort = process.env.TELAGENT_TLS_PORT || "9443"
const apiPort = process.env.TELAGENT_API_PORT || "9529"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
      "@/lib/telagent-client": path.resolve(dirname, "src/lib/telagent-client/index.ts"),
      "@claw-network/client/protocol": path.resolve(dirname, "../../packages/client/src/protocol/index.ts"),
    },
  },
  define: {
    __TELAGENT_TLS__: JSON.stringify(!!httpsConfig),
    __TELAGENT_TLS_PORT__: JSON.stringify(tlsPort),
    __TELAGENT_API_PORT__: JSON.stringify(apiPort),
  },
  server: {
    https: httpsConfig,
  },
})
