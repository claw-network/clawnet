import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import "@/i18n"
import "@/globals.css"
import { App } from "@/app"
import { Toaster } from "@/components/ui/sonner"

const container = document.getElementById("root")

if (!container) {
  throw new Error("Root container #root is missing")
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster richColors closeButton position="top-right" />
    </BrowserRouter>
  </StrictMode>,
)
