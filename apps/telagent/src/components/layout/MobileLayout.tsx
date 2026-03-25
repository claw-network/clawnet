import type { ReactNode } from "react"

import { MobileBottomNav } from "@/components/layout/MobileBottomNav"
import { ReconnectBanner } from "@/components/layout/ReconnectBanner"
import { SessionBadge } from "@/components/session/SessionBadge"
import { UnlockDialog } from "@/components/session/UnlockDialog"
import { ThemeSwitcher } from "@/components/shared/ThemeSwitcher"

interface MobileLayoutProps {
  children: ReactNode
}

export function MobileLayout({ children }: MobileLayoutProps) {
  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-3">
        <h1 className="text-sm font-semibold">TelAgent</h1>
        <div className="flex items-center gap-2">
          <SessionBadge />
          <ThemeSwitcher />
        </div>
      </header>
      <ReconnectBanner />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      <MobileBottomNav />
      <UnlockDialog />
    </div>
  )
}
