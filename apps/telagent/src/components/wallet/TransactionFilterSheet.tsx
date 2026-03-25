import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SlidersHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

export type DateRange = "all" | "7d" | "30d" | "90d"
export type TxCategory = "transfer" | "escrow_create" | "escrow_fund" | "escrow_release" | "escrow_refund"

export interface TransactionFilters {
  dateRange: DateRange
  amountFrom: string
  amountTo: string
  categories: TxCategory[]
}

const DEFAULT_FILTERS: TransactionFilters = {
  dateRange: "all",
  amountFrom: "",
  amountTo: "",
  categories: [],
}

const ALL_CATEGORIES: TxCategory[] = [
  "transfer",
  "escrow_create",
  "escrow_fund",
  "escrow_release",
  "escrow_refund",
]

interface TransactionFilterSheetProps {
  filters: TransactionFilters
  onApply: (filters: TransactionFilters) => void
  /** number of active filters (shown as badge) */
  activeCount: number
}

export function TransactionFilterSheet({ filters, onApply, activeCount }: TransactionFilterSheetProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const [dateRange, setDateRange] = useState<DateRange>(filters.dateRange)
  const [amountFrom, setAmountFrom] = useState(filters.amountFrom)
  const [amountTo, setAmountTo] = useState(filters.amountTo)
  const [categories, setCategories] = useState<TxCategory[]>(filters.categories)

  const syncFromParent = () => {
    setDateRange(filters.dateRange)
    setAmountFrom(filters.amountFrom)
    setAmountTo(filters.amountTo)
    setCategories(filters.categories)
  }

  const onReset = () => {
    setDateRange(DEFAULT_FILTERS.dateRange)
    setAmountFrom(DEFAULT_FILTERS.amountFrom)
    setAmountTo(DEFAULT_FILTERS.amountTo)
    setCategories(DEFAULT_FILTERS.categories)
  }

  const toggleCategory = (cat: TxCategory) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    )
  }

  const handleApply = () => {
    onApply({ dateRange, amountFrom, amountTo, categories })
    setOpen(false)
  }

  const dateOptions: { value: DateRange; label: string }[] = [
    { value: "all", label: t("wallet.filter.dateAll") },
    { value: "7d", label: t("wallet.filter.date7d") },
    { value: "30d", label: t("wallet.filter.date30d") },
    { value: "90d", label: t("wallet.filter.date90d") },
  ]

  const categoryLabels: Record<TxCategory, string> = {
    transfer: t("wallet.filter.catTransfer"),
    escrow_create: t("wallet.filter.catEscrowCreate"),
    escrow_fund: t("wallet.filter.catEscrowFund"),
    escrow_release: t("wallet.filter.catEscrowRelease"),
    escrow_refund: t("wallet.filter.catEscrowRefund"),
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (next) syncFromParent() }}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="relative flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground transition hover:bg-muted/80"
        >
          <SlidersHorizontalIcon className="size-4" />
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {activeCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetClose asChild>
            <button className="text-muted-foreground transition hover:text-foreground">
              <span className="text-sm">←</span>
            </button>
          </SheetClose>
          <SheetTitle>{t("wallet.filter.title")}</SheetTitle>
          <button
            type="button"
            onClick={onReset}
            className="text-sm font-medium text-primary transition hover:text-primary/80"
          >
            {t("wallet.filter.reset")}
          </button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* Date Range */}
          <section className="mb-5">
            <h3 className="mb-2.5 text-sm font-semibold">{t("wallet.filter.dateRange")}</h3>
            <div className="space-y-1">
              {dateOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDateRange(opt.value)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm transition hover:bg-muted/50"
                >
                  <span
                    className={`flex size-5 items-center justify-center rounded-full border-2 transition ${
                      dateRange === opt.value
                        ? "border-primary"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {dateRange === opt.value && (
                      <span className="size-2.5 rounded-full bg-primary" />
                    )}
                  </span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Amount Range */}
          <section className="mb-5">
            <h3 className="mb-2.5 text-sm font-semibold">{t("wallet.filter.amount")}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t("wallet.filter.from")}</label>
                <Input
                  type="number"
                  min={0}
                  value={amountFrom}
                  onChange={(e) => setAmountFrom(e.target.value)}
                  placeholder="0"
                  className="h-9"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t("wallet.filter.to")}</label>
                <Input
                  type="number"
                  min={0}
                  value={amountTo}
                  onChange={(e) => setAmountTo(e.target.value)}
                  placeholder="∞"
                  className="h-9"
                />
              </div>
            </div>
          </section>

          {/* Category */}
          <section className="mb-6">
            <h3 className="mb-2.5 text-sm font-semibold">{t("wallet.filter.category")}</h3>
            <div className="flex flex-wrap gap-2">
              {ALL_CATEGORIES.map((cat) => {
                const active = categories.includes(cat)
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {categoryLabels[cat]}
                    {active && <span>×</span>}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Apply button */}
          <Button className="w-full rounded-xl" size="lg" onClick={handleApply}>
            {t("wallet.filter.apply")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { DEFAULT_FILTERS }
