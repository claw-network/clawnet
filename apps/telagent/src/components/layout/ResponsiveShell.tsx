import { Outlet } from "react-router-dom"

import { DesktopLayout } from "@/components/layout/DesktopLayout"
import { MobileLayout } from "@/components/layout/MobileLayout"
import { useIsMobile } from "@/hooks/use-mobile"

export function ResponsiveShell() {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <MobileLayout>
        <Outlet />
      </MobileLayout>
    )
  }

  return (
    <DesktopLayout>
      <Outlet />
    </DesktopLayout>
  )
}
