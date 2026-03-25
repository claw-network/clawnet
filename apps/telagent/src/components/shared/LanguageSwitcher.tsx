import { LanguagesIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { i18next } from "@/i18n"
import { useUIStore, type Locale } from "@/stores/ui"

export function LanguageSwitcher() {
  const locale = useUIStore((state) => state.locale)
  const setLocale = useUIStore((state) => state.setLocale)
  const { t } = useTranslation()

  const onChangeLocale = async (nextLocale: Locale) => {
    setLocale(nextLocale)
    await i18next.changeLanguage(nextLocale)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <LanguagesIcon className="size-4" />
          {locale.toUpperCase()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void onChangeLocale("en")}>{t("language.english")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void onChangeLocale("zh")}>{t("language.chinese")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
