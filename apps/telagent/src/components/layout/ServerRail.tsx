import { BookUserIcon, MessageCircleIcon, WalletIcon, StoreIcon } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { DidAvatar } from "@/components/shared/DidAvatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useIdentityStore } from "@/stores/identity"
import { useLocation, useNavigate } from "react-router-dom"

type SidebarTab = "conversations" | "contacts"

interface ServerRailProps {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  suppressActive?: boolean
}

export function ServerRail({ activeTab, onTabChange, suppressActive }: ServerRailProps) {
  const { t } = useTranslation()
  const selfDid = useIdentityStore((state) => state.self?.did ?? "")
  const selfProfile = useIdentityStore((state) => state.selfProfile)
  const loadSelfProfile = useIdentityStore((state) => state.loadSelfProfile)
  const location = useLocation()
  const navigate = useNavigate()

  const links = [
    { to: "/market", icon: <StoreIcon className="size-5" />, activeIcon: <StoreIcon className="size-5 fill-current" />, label: t("market.title") },
    { to: "/wallet", icon: <WalletIcon className="size-5" />, activeIcon: <WalletIcon className="size-5 fill-current" />, label: t("wallet.title") },
  ]

  useEffect(() => {
    void loadSelfProfile()
  }, [loadSelfProfile])

  const tabs: { id: SidebarTab; icon: React.ReactNode; activeIcon: React.ReactNode; label: string }[] = [
    { id: "conversations", icon: <MessageCircleIcon className="size-5" />, activeIcon: <MessageCircleIcon className="size-5 fill-current" />, label: t("chat.title") },
    { id: "contacts", icon: <BookUserIcon className="size-5" />, activeIcon: <BookUserIcon className="size-5 fill-current" />, label: t("contact.title") },
  ]

  return (
    <aside className="flex w-[60px] flex-col items-center gap-2 border-r border-border bg-sidebar py-3">
      <TooltipProvider delayDuration={300}>
      {/* Own avatar — links to settings */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/settings"
            title={selfProfile?.nickname || selfDid || t("settings.profile.title")}
            className="mb-1 block shrink-0"
          >
            <DidAvatar
              did={selfDid}
              avatarUrl={selfProfile?.avatarUrl}
              className="size-10 rounded-xl transition-all hover:rounded-2xl"
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{t("settings.profile.title")}</TooltipContent>
      </Tooltip>

      <div className="h-px w-8 bg-border" />

      {/* Navigation tabs */}
      <nav className="flex flex-1 flex-col items-center gap-1 pt-1">
        {tabs.map((tab) => {
          const active = !suppressActive && activeTab === tab.id
          return (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onTabChange(tab.id)}
                  className={`group relative flex size-10 items-center justify-center rounded-xl transition-all ${
                    active
                      ? "text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {/* Active indicator pill */}
                  {active && (
                    <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
                  )}
                  {active ? tab.activeIcon : tab.icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{tab.label}</TooltipContent>
            </Tooltip>
          )
        })}

        <div className="h-px w-8 bg-border" />

        {/* Page links (wallet, market) */}
        {links.map((link) => {
          const active = location.pathname.startsWith(link.to)
          return (
            <Tooltip key={link.to}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => navigate(link.to)}
                  className={`group relative flex size-10 items-center justify-center rounded-xl transition-all ${
                    active
                      ? "text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {active && (
                    <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
                  )}
                  {active ? link.activeIcon : link.icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{link.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
      </TooltipProvider>
    </aside>
  )
}

