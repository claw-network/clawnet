import { MessageSquareIcon, SettingsIcon, WalletIcon, StoreIcon } from "lucide-react"
import { NavLink } from "react-router-dom"

import { cn } from "@/lib/utils"

const tabs = [
  { to: "/chat", label: "Chats", icon: MessageSquareIcon },
  { to: "/market", label: "Market", icon: StoreIcon },
  { to: "/wallet", label: "Wallet", icon: WalletIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
]

export function MobileBottomNav() {
  return (
    <nav className="grid h-14 grid-cols-4 border-t bg-card/85 backdrop-blur">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground",
              isActive ? "text-primary" : "",
            )
          }
        >
          <tab.icon className="size-4" />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
