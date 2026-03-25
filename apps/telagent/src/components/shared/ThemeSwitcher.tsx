import { MoonIcon, SunIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUIStore, type ThemeMode } from "@/stores/ui"

export function ThemeSwitcher() {
  const theme = useUIStore((state) => state.theme)
  const setTheme = useUIStore((state) => state.setTheme)
  const { t } = useTranslation()

  const onChangeTheme = (next: ThemeMode) => {
    setTheme(next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          {theme === "dark" ? <MoonIcon className="size-4" /> : <SunIcon className="size-4" />}
          {t(`theme.${theme}`)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onChangeTheme("dark")}>
          <MoonIcon className="mr-2 size-4" />
          {t("theme.dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChangeTheme("light")}>
          <SunIcon className="mr-2 size-4" />
          {t("theme.light")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
