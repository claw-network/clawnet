import { ArrowDownLeftIcon, ArrowUpRightIcon, LockKeyholeIcon, SearchIcon, WalletIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TransactionFilterSheet, DEFAULT_FILTERS } from "@/components/wallet/TransactionFilterSheet"
import type { TransactionFilters, DateRange, TxCategory } from "@/components/wallet/TransactionFilterSheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { useWalletStore } from "@/stores/wallet"
import type { WalletHistoryItem } from "@/stores/wallet"

type HistoryFilter = "all" | "sent" | "received" | "escrow"

function txIcon(type: string) {
  const lower = type.toLowerCase()
  if (lower.includes("sent") || lower === "transfer_sent") {
    return (
      <span className="flex size-9 items-center justify-center rounded-full bg-red-500/15 text-red-500">
        <ArrowUpRightIcon className="size-4" />
      </span>
    )
  }
  if (lower.includes("received") || lower === "transfer_received") {
    return (
      <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <ArrowDownLeftIcon className="size-4" />
      </span>
    )
  }
  if (lower.includes("escrow")) {
    return (
      <span className="flex size-9 items-center justify-center rounded-full bg-blue-500/15 text-blue-500">
        <LockKeyholeIcon className="size-4" />
      </span>
    )
  }
  return (
    <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <WalletIcon className="size-4" />
    </span>
  )
}

function txLabel(item: WalletHistoryItem): string {
  const lower = item.type.toLowerCase()
  if (lower.includes("sent") || lower === "transfer_sent") {
    return item.to ? `To ${item.to.slice(0, 20)}…` : "Sent"
  }
  if (lower.includes("received") || lower === "transfer_received") {
    return item.from ? `From ${item.from.slice(0, 20)}…` : "Received"
  }
  return item.type
}

function txAmountColor(type: string): string {
  const lower = type.toLowerCase()
  if (lower.includes("sent") || lower === "transfer_sent") return "text-red-500"
  if (lower.includes("received") || lower === "transfer_received") return "text-emerald-500"
  return "text-foreground"
}

function txAmountPrefix(type: string): string {
  const lower = type.toLowerCase()
  if (lower.includes("sent") || lower === "transfer_sent") return "-"
  if (lower.includes("received") || lower === "transfer_received") return "+"
  return ""
}

function formatTime(timestampMs?: number): string {
  if (!timestampMs) return ""
  return new Date(timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function dateLabel(timestampMs?: number): string {
  if (!timestampMs) return ""
  const date = new Date(timestampMs)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  if (sameDay(date, today)) return "Today"
  if (sameDay(date, yesterday)) return "Yesterday"
  return date.toLocaleDateString()
}

function matchesFilter(item: WalletHistoryItem, filter: HistoryFilter): boolean {
  if (filter === "all") return true
  const lower = item.type.toLowerCase()
  if (filter === "sent") return lower.includes("sent") || lower === "transfer_sent"
  if (filter === "received") return lower.includes("received") || lower === "transfer_received"
  if (filter === "escrow") return lower.includes("escrow")
  return true
}

interface TxDetailBodyProps {
  item: WalletHistoryItem
  t: (key: string) => string
}

function TxDetailBody({ item, t }: TxDetailBodyProps) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{t("wallet.type")}</span>
        <Badge variant="outline">{item.type}</Badge>
      </div>
      {item.status && (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("wallet.status")}</span>
            <Badge variant="outline">{item.status}</Badge>
          </div>
        </>
      )}
      {item.amount != null && (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("wallet.amount")}</span>
            <span className={`font-semibold tabular-nums ${txAmountColor(item.type)}`}>
              {txAmountPrefix(item.type)}{item.amount}
            </span>
          </div>
        </>
      )}
      {item.timestampMs != null && (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("wallet.time")}</span>
            <span className="tabular-nums">{new Date(item.timestampMs).toLocaleString()}</span>
          </div>
        </>
      )}
      {item.from && (
        <>
          <Separator />
          <div>
            <p className="text-muted-foreground">{t("wallet.txFrom")}</p>
            <p className="mt-0.5 break-all font-mono text-xs">{item.from}</p>
          </div>
        </>
      )}
      {item.to && (
        <>
          <Separator />
          <div>
            <p className="text-muted-foreground">{t("wallet.txTo")}</p>
            <p className="mt-0.5 break-all font-mono text-xs">{item.to}</p>
          </div>
        </>
      )}
      {item.txHash && (
        <>
          <Separator />
          <div>
            <p className="text-muted-foreground">{t("wallet.txHash")}</p>
            <p className="mt-0.5 break-all font-mono text-xs">{item.txHash}</p>
          </div>
        </>
      )}
      {item.escrowId && (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("wallet.escrowId")}</span>
            <span className="font-mono text-xs">{item.escrowId}</span>
          </div>
        </>
      )}
    </div>
  )
}

export function TransactionHistory() {
  const { t } = useTranslation()
  const history = useWalletStore((state) => state.history)
  const historyLimit = useWalletStore((state) => state.historyLimit)
  const historyOffset = useWalletStore((state) => state.historyOffset)
  const setHistoryPage = useWalletStore((state) => state.setHistoryPage)
  const loading = useWalletStore((state) => state.loading)

  const [filter, setFilter] = useState<HistoryFilter>("all")
  const [search, setSearch] = useState("")
  const [advFilters, setAdvFilters] = useState<TransactionFilters>(DEFAULT_FILTERS)
  const [selectedTx, setSelectedTx] = useState<WalletHistoryItem | null>(null)
  const isMobile = useIsMobile()

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (advFilters.dateRange !== "all") count++
    if (advFilters.amountFrom.trim()) count++
    if (advFilters.amountTo.trim()) count++
    count += advFilters.categories.length
    return count
  }, [advFilters])

  const currentPage = Math.floor(historyOffset / historyLimit) + 1
  const hasPrevious = currentPage > 1
  const hasNext = history.length >= historyLimit

  const filters: { value: HistoryFilter; label: string }[] = [
    { value: "all", label: t("wallet.filterAll") },
    { value: "sent", label: t("wallet.sent") },
    { value: "received", label: t("wallet.received") },
    { value: "escrow", label: t("wallet.escrow") },
  ]

  const grouped = useMemo(() => {
    const query = search.trim().toLowerCase()

    // date range cutoff
    let cutoffMs = 0
    if (advFilters.dateRange === "7d") cutoffMs = Date.now() - 7 * 86400000
    else if (advFilters.dateRange === "30d") cutoffMs = Date.now() - 30 * 86400000
    else if (advFilters.dateRange === "90d") cutoffMs = Date.now() - 90 * 86400000

    // amount range
    const minAmount = advFilters.amountFrom.trim() ? Number(advFilters.amountFrom) : undefined
    const maxAmount = advFilters.amountTo.trim() ? Number(advFilters.amountTo) : undefined

    // category set
    const catSet: Set<string> = new Set(advFilters.categories)

    const items = history
      .filter((item) => matchesFilter(item, filter))
      .filter((item) => {
        if (!query) return true
        return (
          item.type.toLowerCase().includes(query) ||
          item.txHash?.toLowerCase().includes(query) ||
          item.from?.toLowerCase().includes(query) ||
          item.to?.toLowerCase().includes(query) ||
          item.escrowId?.toLowerCase().includes(query)
        )
      })
      .filter((item) => {
        if (cutoffMs > 0 && (item.timestampMs ?? 0) < cutoffMs) return false
        const amt = item.amount ?? 0
        if (minAmount != null && Number.isFinite(minAmount) && amt < minAmount) return false
        if (maxAmount != null && Number.isFinite(maxAmount) && amt > maxAmount) return false
        if (catSet.size > 0) {
          const lower = item.type.toLowerCase()
          const matchesCat =
            (catSet.has("transfer") && (lower.includes("transfer") || lower.includes("sent") || lower.includes("received"))) ||
            (catSet.has("escrow_create") && lower.includes("escrow") && lower.includes("creat")) ||
            (catSet.has("escrow_fund") && lower.includes("escrow") && lower.includes("fund")) ||
            (catSet.has("escrow_release") && lower.includes("escrow") && lower.includes("release")) ||
            (catSet.has("escrow_refund") && lower.includes("escrow") && lower.includes("refund"))
          if (!matchesCat) return false
        }
        return true
      })

    const groups: { label: string; items: WalletHistoryItem[] }[] = []
    let currentLabel = ""
    for (const item of items) {
      const label = dateLabel(item.timestampMs) || "Unknown"
      if (label !== currentLabel) {
        groups.push({ label, items: [] })
        currentLabel = label
      }
      groups[groups.length - 1].items.push(item)
    }
    return groups
  }, [history, filter, search, advFilters])

  return (
    <div className="mt-1 space-y-3">
      {/* Filter tabs + filter button */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1 overflow-x-auto">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                filter === f.value
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <TransactionFilterSheet
          filters={advFilters}
          onApply={setAdvFilters}
          activeCount={activeFilterCount}
        />
      </div>

      {/* Search bar */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("wallet.searchHistory")}
          className="h-9 pl-9 text-sm"
        />
      </div>

      {/* Transaction list */}
      {grouped.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("wallet.noHistory")}</p>
      ) : (
        grouped.map((group) => (
          <div key={group.label}>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTx(item)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedTx(item)}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-muted/40"
                >
                  {txIcon(item.type)}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{txLabel(item)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {item.type} · {formatTime(item.timestampMs)}
                      {item.status ? ` · ${item.status}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-semibold ${txAmountColor(item.type)}`}>
                      {txAmountPrefix(item.type)}
                      {typeof item.amount === "number" ? item.amount : "-"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{item.type}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Pagination */}
      {(hasPrevious || hasNext) && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrevious || loading}
            onClick={() => void setHistoryPage(currentPage - 1)}
          >
            {t("details.prev")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("details.page")} {currentPage}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext || loading}
            onClick={() => void setHistoryPage(currentPage + 1)}
          >
            {t("details.next")}
          </Button>
        </div>
      )}

      {/* Transaction detail — Sheet on mobile, Dialog on tablet/desktop */}
      {isMobile ? (
        <Sheet open={selectedTx !== null} onOpenChange={(open) => { if (!open) setSelectedTx(null) }}>
          <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl px-4 pb-8">
            <SheetHeader className="mb-4">
              <SheetTitle>{t("wallet.txDetail")}</SheetTitle>
            </SheetHeader>
            {selectedTx && <TxDetailBody item={selectedTx} t={t} />}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={selectedTx !== null} onOpenChange={(open) => { if (!open) setSelectedTx(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader className="mb-2">
              <DialogTitle>{t("wallet.txDetail")}</DialogTitle>
            </DialogHeader>
            {selectedTx && <TxDetailBody item={selectedTx} t={t} />}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
