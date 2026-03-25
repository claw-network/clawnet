import type { ReactNode } from "react"
import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { XIcon } from "lucide-react"

import { ConversationDetailPanel } from "@/components/chat/ConversationDetailPanel"
import { ContactInfoPanel } from "@/components/contact/ContactInfoPanel"
import { ContactList } from "@/components/contact/ContactList"
import { ReconnectBanner } from "@/components/layout/ReconnectBanner"
import { ServerRail } from "@/components/layout/ServerRail"
import { ConversationList } from "@/components/chat/ConversationList"
import { UnlockDialog } from "@/components/session/UnlockDialog"
import { Button } from "@/components/ui/button"
import { useUIStore } from "@/stores/ui"
import { useConversationStore } from "@/stores/conversation"

type SidebarTab = "conversations" | "contacts"

interface DesktopLayoutProps {
  children: ReactNode
}

export function DesktopLayout({ children }: DesktopLayoutProps) {
  const detailPanelOpen = useUIStore((state) => state.detailPanelOpen)
  const setDetailPanelOpen = useUIStore((state) => state.setDetailPanelOpen)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("conversations")
  const [selectedContactDid, setSelectedContactDid] = useState<string | null>(null)
  const setSelectedConversationId = useConversationStore((state) => state.setSelectedConversationId)
  const location = useLocation()
  const navigate = useNavigate()
  const isFullPage = location.pathname === "/settings" || location.pathname.startsWith("/wallet") || location.pathname.startsWith("/market")

  const handleTabChange = (tab: SidebarTab) => {
    setSidebarTab(tab)
    if (isFullPage) {
      navigate("/chat")
    }
  }

  const handleOpenChat = (conversationId: string) => {
    setSelectedConversationId(conversationId)
    setSidebarTab("conversations")
  }

  return (
    <div className="flex h-svh flex-col">
      <ReconnectBanner />

      <div className="flex min-h-0 flex-1">
        <ServerRail activeTab={sidebarTab} onTabChange={handleTabChange} suppressActive={isFullPage} />

        {!isFullPage && (
          <aside className="flex w-[240px] min-w-[200px] flex-col border-r border-border bg-card">
            {sidebarTab === "conversations" ? (
              <ConversationList />
            ) : (
              <ContactList
                selectedDid={selectedContactDid}
                onSelect={setSelectedContactDid}
              />
            )}
          </aside>
        )}

        <main className="min-w-0 flex-1">
          {!isFullPage && sidebarTab === "contacts" && selectedContactDid ? (
            <ContactInfoPanel
              did={selectedContactDid}
              onOpenChat={handleOpenChat}
              onContactRemoved={() => setSelectedContactDid(null)}
            />
          ) : (
            children
          )}
        </main>

        {!isFullPage && sidebarTab === "conversations" && detailPanelOpen ? (
          <aside className="hidden w-[320px] min-w-[280px] max-w-[460px] resize-x overflow-auto border-l border-border bg-card p-4 lg:block">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Details</h2>
              <Button variant="ghost" size="icon-sm" onClick={() => setDetailPanelOpen(false)}>
                <XIcon className="size-4" />
              </Button>
            </div>
            <ConversationDetailPanel />
          </aside>
        ) : null}
      </div>

      <UnlockDialog />
    </div>
  )
}
