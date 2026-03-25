import { ArrowLeftIcon } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"

import { EscrowDetail } from "@/components/wallet/EscrowDetail"
import { EscrowList } from "@/components/wallet/EscrowList"
import { Button } from "@/components/ui/button"
import { useWalletStore } from "@/stores/wallet"

export function WalletEscrowPage() {
  const { t } = useTranslation()
  const { escrowId = "" } = useParams<{ escrowId: string }>()
  const refreshAll = useWalletStore((state) => state.refreshAll)

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-auto p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/wallet">
            <ArrowLeftIcon className="size-4" />
            {t("wallet.backToWallet")}
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <EscrowList activeEscrowId={escrowId} />
        <EscrowDetail escrowId={escrowId} />
      </div>
    </div>
  )
}
