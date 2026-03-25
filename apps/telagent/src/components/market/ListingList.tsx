import { SearchIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { PublishDialog } from "@/components/market/PublishDialog"
import { EmptyState } from "@/components/shared/EmptyState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { ListingType } from "@/stores/market"
import { useMarketStore } from "@/stores/market"

interface ListingListProps {
  activeListingId?: string
}

function formatPrice(value?: number): string {
  if (typeof value !== "number") return "-"
  return value.toFixed(4)
}

const TYPE_BADGE_VARIANT: Record<ListingType, "default" | "secondary" | "outline"> = {
  info: "secondary",
  task: "default",
  capability: "outline",
}

export function ListingList({ activeListingId }: ListingListProps) {
  const { t } = useTranslation()
  const listings = useMarketStore((state) => state.listings)
  const searchResults = useMarketStore((state) => state.searchResults)
  const activeFilter = useMarketStore((state) => state.activeFilter)
  const setActiveFilter = useMarketStore((state) => state.setActiveFilter)
  const refreshListings = useMarketStore((state) => state.refreshListings)
  const searchMarkets = useMarketStore((state) => state.searchMarkets)
  const loading = useMarketStore((state) => state.loadingListings)

  const [query, setQuery] = useState("")

  const showingSearch = query.trim().length > 0
  const rows = useMemo(() => (showingSearch ? searchResults : listings), [searchResults, showingSearch, listings])

  const onSearch = async () => {
    const normalized = query.trim()
    if (!normalized) {
      await refreshListings()
      return
    }
    await searchMarkets(normalized, activeFilter === "all" ? undefined : activeFilter)
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("market.title")}</CardTitle>
          <PublishDialog onPublished={() => refreshListings()} />
        </div>

        <div className="flex flex-1 gap-1 overflow-x-auto">
          {([
            { value: "all", label: t("market.filterAll") },
            { value: "info", label: t("market.filterInfo") },
            { value: "task", label: t("market.filterTask") },
            { value: "capability", label: t("market.filterCapability") },
          ] as const).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setActiveFilter(f.value as ListingType | "all")}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                activeFilter === f.value
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("market.search")}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void onSearch()
              }
            }}
          />
          <Button variant="outline" onClick={() => void onSearch()} disabled={loading}>
            <SearchIcon className="size-4" />
            {t("market.searchButton")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <EmptyState
            title={showingSearch ? t("market.noSearchResults") : t("market.noListings")}
            description={showingSearch ? t("market.noSearchResultsHint") : t("market.selectListing")}
          />
        ) : (
          rows.map((listing) => {
            const active = activeListingId === listing.id

            return (
              <Link
                key={listing.id}
                to={`/market/${listing.type}/${encodeURIComponent(listing.id)}`}
                className={`block rounded-md border p-3 transition-colors hover:border-primary ${active ? "border-primary bg-primary/5" : "bg-card/40"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={TYPE_BADGE_VARIANT[listing.type]}>
                      {t(`market.type_${listing.type}`)}
                    </Badge>
                    <p className="font-medium">{listing.title}</p>
                  </div>
                  <Badge variant="outline">{listing.status}</Badge>
                </div>
                {listing.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{listing.description}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{t("market.price")}: {formatPrice(listing.price)}</span>
                  {listing.owner ? <span>{t("market.owner")}: {listing.owner}</span> : null}
                </div>
              </Link>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
