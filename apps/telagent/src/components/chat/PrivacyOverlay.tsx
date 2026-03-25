import { LockIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

export function PrivacyOverlay() {
  const { t } = useTranslation()

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center backdrop-blur-xl bg-[color:var(--privacy-overlay)]">
      <LockIcon className="mb-3 size-10 text-muted-foreground" />
      <p className="text-base font-semibold text-muted-foreground">{t("chat.private")}</p>
      <p className="mt-1 text-sm text-muted-foreground/80">{t("chat.privateDescription")}</p>
    </div>
  )
}
