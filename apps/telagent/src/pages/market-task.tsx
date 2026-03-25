import { ArrowLeftIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"

import { TaskDetail } from "@/components/market/TaskDetail"
import { TaskList } from "@/components/market/TaskList"
import { Button } from "@/components/ui/button"

export function MarketTaskPage() {
  const { t } = useTranslation()
  const { taskId = "" } = useParams<{ taskId: string }>()

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-auto p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/market">
            <ArrowLeftIcon className="size-4" />
            {t("market.backToMarket")}
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <TaskList activeTaskId={taskId} />
        <TaskDetail taskId={taskId} />
      </div>
    </div>
  )
}
