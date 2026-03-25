import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher"
import { ConnectForm } from "@/components/connect/ConnectForm"

export function ConnectPage() {
  return (
    <div className="relative flex min-h-svh items-center justify-center px-4 py-8">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <ConnectForm />
    </div>
  )
}
