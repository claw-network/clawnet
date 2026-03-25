import { SearchIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { PublishDialog } from "@/components/market/PublishDialog"
import { EmptyState } from "@/components/shared/EmptyState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useMarketStore } from "@/stores/market"

interface TaskListProps {
  activeTaskId?: string
}

function formatBudget(value?: number): string {
  if (typeof value !== "number") {
    return "-"
  }
  return value.toFixed(4)
}

export function TaskList({ activeTaskId }: TaskListProps) {
  const { t } = useTranslation()
  const listings = useMarketStore((state) => state.listings)
  const searchResults = useMarketStore((state) => state.searchResults)
  const refreshListings = useMarketStore((state) => state.refreshListings)
  const searchMarkets = useMarketStore((state) => state.searchMarkets)
  const loadingListings = useMarketStore((state) => state.loadingListings)

  const [query, setQuery] = useState("")

  useEffect(() => {
    void refreshListings()
  }, [refreshListings])

  const showingSearch = query.trim().length > 0
  const rows = useMemo(() => (showingSearch ? searchResults : listings), [searchResults, showingSearch, listings])

  const onSearch = async () => {
    const normalized = query.trim()
    if (!normalized) {
      await refreshListings()
      return
    }
    await searchMarkets(normalized)
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("market.tasks")}</CardTitle>
          <PublishDialog onPublished={() => refreshListings()} />
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
          <Button variant="outline" onClick={() => void onSearch()} disabled={loadingListings}>
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
          rows.map((task) => {
            const active = activeTaskId === task.id

            return (
              <Link
                key={task.id}
                to={`/market/tasks/${encodeURIComponent(task.id)}`}
                className={`block rounded-md border p-3 transition-colors hover:border-primary ${active ? "border-primary bg-primary/5" : "bg-card/40"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{task.title}</p>
                    {task.description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
                    ) : null}
                  </div>
                  <Badge variant="outline">{task.status}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{t("market.price")}: {formatBudget(task.price)}</span>
                  {task.owner ? <span>{t("market.owner")}: {task.owner}</span> : null}
                </div>
              </Link>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
