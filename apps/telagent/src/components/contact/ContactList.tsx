import { SearchIcon, UserRoundPlusIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { AddContactDialog } from "@/components/contact/AddContactDialog"
import { DidAvatar } from "@/components/shared/DidAvatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useContactStore } from "@/stores/contact"

interface ContactListProps {
  selectedDid?: string | null
  onSelect: (did: string) => void
}

export function ContactList({ selectedDid, onSelect }: ContactListProps) {
  const { t } = useTranslation()
  const contacts = useContactStore((state) => state.contacts)
  const loadContacts = useContactStore((state) => state.loadContacts)
  const getEffectiveDisplayName = useContactStore((state) => state.getEffectiveDisplayName)
  const getEffectiveAvatarUrl = useContactStore((state) => state.getEffectiveAvatarUrl)
  const [addOpen, setAddOpen] = useState(false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = contacts
      .map((c) => ({
        did: c.did,
        displayName: getEffectiveDisplayName(c.did),
        avatarUrl: getEffectiveAvatarUrl(c.did),
      }))
      .filter((c) => !q || c.displayName.toLowerCase().includes(q) || c.did.toLowerCase().includes(q))
    list.sort((a, b) => a.displayName.localeCompare(b.displayName))
    return list
  }, [contacts, query, getEffectiveDisplayName, getEffectiveAvatarUrl])

  return (
    <div className="flex h-full flex-col text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">{t("contact.title")}</h2>
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setAddOpen(true)}
          aria-label={t("contact.add")}
        >
          <UserRoundPlusIcon className="size-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.8}
          />
          <Input
            value={query}
            placeholder={t("chat.search")}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-9 text-sm"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="min-h-0 flex-1 px-3">
        <div className="pb-4">
          {sorted.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {query ? "没有搜索结果" : "暂无联系人"}
            </p>
          ) : (
            sorted.map((contact) => (
              <button
                type="button"
                key={contact.did}
                onClick={() => onSelect(contact.did)}
                className={`mb-0.5 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                  selectedDid === contact.did
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <DidAvatar
                  did={contact.did}
                  avatarUrl={contact.avatarUrl}
                  className="size-9 shrink-0"
                />
                <span className="truncate text-sm font-semibold text-foreground">
                  {contact.displayName}
                </span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      <AddContactDialog open={addOpen} onOpenChange={setAddOpen} hideTrigger />
    </div>
  )
}
