import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { BalanceCard } from "@/components/wallet/BalanceCard"
import { TransactionHistory } from "@/components/wallet/TransactionHistory"
import { Button } from "@/components/ui/button"
import { useWalletStore } from "@/stores/wallet"

export function WalletPage() {
  const { t } = useTranslation()
  const refreshAll = useWalletStore((state) => state.refreshAll)
  const error = useWalletStore((state) => state.error)

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-xl font-bold">{t("wallet.title")}</h2>
        <Button asChild>
          <Link to="/wallet/transfer">{t("wallet.transfer")}</Link>
        </Button>
      </div>

      {error ? <p className="px-4 text-sm text-destructive">{error}</p> : null}

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <BalanceCard onRefresh={refreshAll} />
        <TransactionHistory />
      </div>
    </div>
  )
}
