import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { ListingList } from "@/components/market/ListingList"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useMarketStore } from "@/stores/market"

export function MarketPage() {
  const { t } = useTranslation()
  const refreshListings = useMarketStore((state) => state.refreshListings)
  const error = useMarketStore((state) => state.error)

  useEffect(() => {
    void refreshListings()
  }, [refreshListings])

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("market.title")}</h2>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <ListingList />
        <Card>
          <CardHeader>
            <CardTitle>{t("market.listingDetail")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t("market.selectListing")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
