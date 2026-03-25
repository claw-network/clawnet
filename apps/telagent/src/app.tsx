import { useEffect } from "react"
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom"

import { ResponsiveShell } from "@/components/layout/ResponsiveShell"
import { usePollMessages } from "@/hooks/use-poll-messages"
import { useGlobalErrorToast } from "@/hooks/use-global-error-toast"
import { useAutoReconnect } from "@/hooks/use-auto-reconnect"
import { i18next } from "@/i18n"
import { ChatPage } from "@/pages/chat"
import { ChatInfoPage } from "@/pages/chat-info"
import { ChatViewPage } from "@/pages/chat-view"
import { ConnectPage } from "@/pages/connect"
import { MarketPage } from "@/pages/market"
import { MarketDetailPage } from "@/pages/market-detail"
import { SettingsPage } from "@/pages/settings"
import { WalletPage } from "@/pages/wallet"
import { WalletEscrowPage } from "@/pages/wallet-escrow"
import { WalletTransferPage } from "@/pages/wallet-transfer"
import { useConnectionStore } from "@/stores/connection"
import { useIdentityStore } from "@/stores/identity"
import { usePermissionStore } from "@/stores/permission"
import { useUIStore } from "@/stores/ui"
import { useConversationStore } from "@/stores/conversation"
import { useSessionStore } from "@/stores/session"

function Bootstrap() {
  const reconnectFromStorage = useConnectionStore((state) => state.reconnectFromStorage)
  const status = useConnectionStore((state) => state.status)
  const locale = useUIStore((state) => state.locale)
  const loadSelf = useIdentityStore((state) => state.loadSelf)
  const refreshPermissions = usePermissionStore((state) => state.refresh)
  const refreshConversations = useConversationStore((state) => state.refreshFromApi)
  const refreshSession = useSessionStore((state) => state.refresh)
  const clearSession = useSessionStore((state) => state.clear)

  useGlobalErrorToast()

  useEffect(() => {
    void reconnectFromStorage()
  }, [reconnectFromStorage])

  useEffect(() => {
    void i18next.changeLanguage(locale)
  }, [locale])

  useEffect(() => {
    if (status !== "connected") {
      clearSession()
      return
    }
    void loadSelf()
    void refreshPermissions()
    void refreshConversations()
    void refreshSession()
  }, [clearSession, loadSelf, refreshConversations, refreshPermissions, refreshSession, status])

  return null
}

function ConnectRouteGuard() {
  const status = useConnectionStore((state) => state.status)
  if (status === "connected") {
    return <Navigate to="/chat" replace />
  }
  return <ConnectPage />
}

function ProtectedRoute() {
  const status = useConnectionStore((state) => state.status)
  const location = useLocation()

  if (status !== "connected") {
    return <Navigate to="/connect" replace state={{ from: location }} />
  }
  return <Outlet />
}

function PollingShell() {
  usePollMessages()
  useAutoReconnect()
  return <ResponsiveShell />
}

export function App() {
  return (
    <>
      <Bootstrap />
      <Routes>
        <Route path="/connect" element={<ConnectRouteGuard />} />
        <Route path="/" element={<Navigate to="/chat" replace />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<PollingShell />}>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:conversationId" element={<ChatViewPage />} />
            <Route path="/chat/:conversationId/info" element={<ChatInfoPage />} />
            <Route path="/market" element={<MarketPage />} />
            <Route path="/market/:type/:id" element={<MarketDetailPage />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/wallet/transfer" element={<WalletTransferPage />} />
            <Route path="/wallet/escrow/:escrowId" element={<WalletEscrowPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </>
  )
}
