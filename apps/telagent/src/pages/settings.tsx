import { type ReactNode, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowLeftIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  GlobeIcon,
  LogOutIcon,
  MoonIcon,
  PaletteIcon,
  PencilIcon,
  ServerIcon,
  ShieldCheckIcon,
  SunIcon,
  UserIcon,
} from "lucide-react"
import { toast } from "sonner"

import { DidAvatar } from "@/components/shared/DidAvatar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { useIsMobile } from "@/hooks/use-mobile"
import { i18next } from "@/i18n"
import { useConnectionStore } from "@/stores/connection"
import { useIdentityStore } from "@/stores/identity"
import { usePermissionStore } from "@/stores/permission"
import { useSessionStore } from "@/stores/session"
import { useUIStore, type Locale, type ThemeMode } from "@/stores/ui"

/* ─── sub-view type ─── */
type SettingsView = "main" | "profile" | "appearance" | "language" | "node"

/* ─── helpers ─── */

function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-lg px-3 py-6 sm:px-4 md:max-w-3xl md:px-8">{children}</div>
    </div>
  )
}

function SubHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      {onBack && (
        <button
          onClick={onBack}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted md:hidden"
        >
          <ArrowLeftIcon className="size-5" />
        </button>
      )}
      <h2 className="text-lg font-semibold md:hidden">{title}</h2>
    </div>
  )
}

function MenuRow({
  icon,
  iconBg,
  label,
  value,
  onClick,
  destructive,
}: {
  icon: ReactNode
  iconBg: string
  label: string
  value?: string
  onClick?: () => void
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-muted"
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white"
        style={{ background: iconBg }}
      >
        {icon}
      </span>
      <span className={`flex-1 text-sm ${destructive ? "text-destructive" : ""}`}>{label}</span>
      {value && <span className="text-xs text-muted-foreground">{value}</span>}
      {!destructive && <ChevronRightIcon className="size-4 text-muted-foreground" />}
    </button>
  )
}

/* ─── profile info row (tap to copy) ─── */

function ProfileInfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { t } = useTranslation()
  const handleCopy = () => {
    if (!value) return
    void navigator.clipboard.writeText(value)
    toast.info(t("settings.profile.copiedToast"))
  }
  return (
    <button
      onClick={handleCopy}
      className="flex w-full items-start justify-between gap-3 rounded-lg px-4 py-3 text-left transition hover:bg-muted/60"
    >
      <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={`break-all text-right text-sm ${mono ? "font-mono text-xs" : ""}`}
          title={value}
        >
          {value || "—"}
        </span>
        {value && <CopyIcon className="size-3 shrink-0 text-muted-foreground" />}
      </div>
    </button>
  )
}

/* ─── profile sub-view ─── */

function ProfileView({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation()
  const nodeUrl = useConnectionStore((s) => s.nodeUrl)
  const selfIdentity = useIdentityStore((s) => s.self)
  const selfDid = selfIdentity?.did ?? ""
  const selfProfile = useIdentityStore((s) => s.selfProfile)
  const loadSelfProfile = useIdentityStore((s) => s.loadSelfProfile)
  const updateSelfProfile = useIdentityStore((s) => s.updateSelfProfile)
  const uploadAvatar = useIdentityStore((s) => s.uploadAvatar)

  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState("")
  const [avatarUrl, setAvatarUrl] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadSelfProfile()
  }, [loadSelfProfile])

  useEffect(() => {
    if (selfProfile) {
      setNickname(selfProfile.nickname ?? "")
      setAvatarUrl(selfProfile.avatarUrl ?? "")
    }
  }, [selfProfile])

  const onSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await updateSelfProfile({
        nickname: nickname.trim() || undefined,
        avatarUrl: avatarUrl.trim() || undefined,
      })
      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        setEditing(false)
      }, 1200)
    } finally {
      setSaving(false)
    }
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      const [header, base64] = dataUrl.split(",")
      const mimeType = header?.match(/:(.*?);/)?.[1] ?? "image/jpeg"
      try {
        const newUrl = await uploadAvatar(base64, mimeType)
        setAvatarUrl(newUrl)
      } catch {
        /* silently handle */
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }

  const resolvedAvatarUrl = (() => {
    const url = avatarUrl || selfProfile?.avatarUrl || ""
    return url.startsWith("/") ? `${nodeUrl?.replace(/\/$/, "")}${url}` : url
  })()

  return (
    <SettingsShell>
      <SubHeader title={t("settings.profile.title")} onBack={onBack} />

      {/* ── hero: avatar + name + status ── */}
      <div className="mb-6 flex flex-col items-center gap-3">
        <div className="relative">
          <DidAvatar did={selfDid} avatarUrl={resolvedAvatarUrl} className="size-24" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-0 right-0 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow transition hover:bg-primary/90"
          >
            <CameraIcon className="size-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={onFileChange}
          />
        </div>
        <div className="text-center">
          <p className="text-xl font-bold">{selfProfile?.nickname || selfDid.slice(0, 16)}</p>
          <p className="mt-0.5 max-w-[280px] truncate text-xs text-muted-foreground">{selfDid}</p>
        </div>
        {selfIdentity?.isActive != null && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              selfIdentity.isActive
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/15 text-destructive"
            }`}
          >
            <ShieldCheckIcon className="size-3" />
            {selfIdentity.isActive ? t("details.active") : t("details.inactive")}
          </span>
        )}
      </div>

      {/* ── identity info card ── */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("settings.profile.identity")}
        </p>
        <div className="divide-y divide-muted/30 rounded-xl bg-muted/40">
          <ProfileInfoRow label={t("details.did")} value={selfDid} mono />
          {selfIdentity?.controller && (
            <ProfileInfoRow label={t("details.controller")} value={selfIdentity.controller} mono />
          )}
          {selfIdentity?.publicKey && (
            <ProfileInfoRow label={t("details.publicKey")} value={selfIdentity.publicKey} mono />
          )}
          {nodeUrl && (
            <ProfileInfoRow label={t("settings.node")} value={nodeUrl} />
          )}
        </div>
      </div>

      {/* ── edit profile (collapsible) ── */}
      {!editing ? (
        <button
          onClick={() => setEditing(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-muted/40 py-3 text-sm text-primary transition hover:bg-muted/60"
        >
          <PencilIcon className="size-4" />
          {t("settings.profile.editInfo")}
        </button>
      ) : (
        <div className="space-y-4 rounded-xl bg-muted/40 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="nickname" className="text-xs text-muted-foreground">
              {t("settings.profile.nickname")}
            </Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t("settings.profile.nickname")}
              maxLength={64}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onSave} disabled={saving} size="sm">
              {saved ? (
                <>
                  <CheckIcon className="mr-1 size-4" />
                  {t("settings.profile.saved")}
                </>
              ) : (
                t("settings.profile.save")
              )}
            </Button>
          </div>
        </div>
      )}
    </SettingsShell>
  )
}

/* ─── appearance sub-view ─── */

function AppearanceView({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation()
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)

  const options: { value: ThemeMode; icon: ReactNode; label: string }[] = [
    { value: "dark", icon: <MoonIcon className="size-5" />, label: t("theme.dark") },
    { value: "light", icon: <SunIcon className="size-5" />, label: t("theme.light") },
  ]

  return (
    <SettingsShell>
      <SubHeader title={t("settings.theme")} onBack={onBack} />
      <div className="space-y-1 rounded-xl bg-muted/40 p-2">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => setTheme(o.value)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              theme === o.value ? "bg-primary/15 text-primary" : "hover:bg-muted"
            }`}
          >
            {o.icon}
            <span className="flex-1 text-left">{o.label}</span>
            {theme === o.value && <CheckIcon className="size-4 text-primary" />}
          </button>
        ))}
      </div>
    </SettingsShell>
  )
}

/* ─── language sub-view ─── */

function LanguageView({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation()
  const locale = useUIStore((s) => s.locale)
  const setLocale = useUIStore((s) => s.setLocale)

  const options: { value: Locale; label: string }[] = [
    { value: "en", label: t("language.english") },
    { value: "zh", label: t("language.chinese") },
  ]

  const onChange = async (next: Locale) => {
    setLocale(next)
    await i18next.changeLanguage(next)
  }

  return (
    <SettingsShell>
      <SubHeader title={t("settings.language")} onBack={onBack} />
      <div className="space-y-1 rounded-xl bg-muted/40 p-2">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => void onChange(o.value)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              locale === o.value ? "bg-primary/15 text-primary" : "hover:bg-muted"
            }`}
          >
            <span className="flex-1 text-left">{o.label}</span>
            {locale === o.value && <CheckIcon className="size-4 text-primary" />}
          </button>
        ))}
      </div>
    </SettingsShell>
  )
}

/* ─── node sub-view ─── */

function NodeView({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation()
  const nodeUrl = useConnectionStore((s) => s.nodeUrl)
  const connectionStatus = useConnectionStore((s) => s.status)
  const reconnectHintVisible = useConnectionStore((s) => s.reconnectHintVisible)
  const reconnectFromStorage = useConnectionStore((s) => s.reconnectFromStorage)
  const pollingState = useUIStore((s) => s.pollingState)

  const connected = connectionStatus === "connected"

  return (
    <SettingsShell>
      <SubHeader title={t("settings.node")} onBack={onBack} />

      {/* Node URL */}
      <div className="rounded-xl bg-muted/40 p-4">
        <p className="text-xs text-muted-foreground">{t("settings.node")}</p>
        <p className="mt-1 break-all text-sm">{nodeUrl || t("common.disconnected")}</p>
      </div>

      {/* Connection status */}
      <div className="mt-4 space-y-3 rounded-xl bg-muted/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("status.title", "Status")}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-sm">{t("common.connected")}</span>
          <Badge variant={connected ? "success" : "destructive"}>{connectionStatus}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">{t("status.polling")}</span>
          <Badge variant="secondary">{pollingState}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">{t("status.sync")}</span>
          <Badge variant={connected ? "outline" : "destructive"}>{connected ? "ok" : "down"}</Badge>
        </div>
        {nodeUrl && reconnectHintVisible && (
          <Button size="sm" variant="destructive" className="w-full" onClick={() => void reconnectFromStorage()}>
            {t("status.reconnectNow")}
          </Button>
        )}
      </div>
    </SettingsShell>
  )
}

/* ─── navigation items ─── */

const NAV_ITEMS: { view: SettingsView; icon: typeof UserIcon; labelKey: string }[] = [
  { view: "profile", icon: UserIcon, labelKey: "settings.profile.title" },
  { view: "appearance", icon: PaletteIcon, labelKey: "settings.theme" },
  { view: "language", icon: GlobeIcon, labelKey: "settings.language" },
  { view: "node", icon: ServerIcon, labelKey: "settings.node" },
]

/* ─── view label for breadcrumb ─── */

function useViewLabel(view: SettingsView) {
  const { t } = useTranslation()
  const map: Record<SettingsView, string> = {
    main: t("settings.title"),
    profile: t("settings.profile.title"),
    appearance: t("settings.theme"),
    language: t("settings.language"),
    node: t("settings.node"),
  }
  return map[view]
}

/* ─── settings content renderer ─── */

function SettingsContent({ view, onBack }: { view: SettingsView; onBack?: () => void }) {
  switch (view) {
    case "profile":
      return <ProfileView onBack={onBack} />
    case "appearance":
      return <AppearanceView onBack={onBack} />
    case "language":
      return <LanguageView onBack={onBack} />
    case "node":
      return <NodeView onBack={onBack} />
    default:
      return null
  }
}

/* ─── mobile settings main menu ─── */

function MobileSettingsMain({ onNavigate }: { onNavigate: (view: SettingsView) => void }) {
  const { t } = useTranslation()
  const nodeUrl = useConnectionStore((s) => s.nodeUrl)
  const disconnect = useConnectionStore((s) => s.disconnect)
  const clearPermissions = usePermissionStore((s) => s.clear)
  const clearSession = useSessionStore((s) => s.clear)
  const selfDid = useIdentityStore((s) => s.self?.did ?? "")
  const selfProfile = useIdentityStore((s) => s.selfProfile)
  const loadSelfProfile = useIdentityStore((s) => s.loadSelfProfile)
  const theme = useUIStore((s) => s.theme)
  const locale = useUIStore((s) => s.locale)

  useEffect(() => {
    void loadSelfProfile()
  }, [loadSelfProfile])

  const onDisconnect = () => {
    disconnect()
    clearPermissions()
    clearSession()
  }

  const resolvedAvatarUrl = (() => {
    const url = selfProfile?.avatarUrl ?? ""
    return url.startsWith("/") ? `${nodeUrl?.replace(/\/$/, "")}${url}` : url
  })()

  return (
    <SettingsShell>
      <h2 className="mb-5 text-lg font-semibold">{t("settings.title")}</h2>

      {/* profile hero */}
      <button
        onClick={() => onNavigate("profile")}
        className="mb-5 flex w-full items-center gap-3 rounded-xl bg-muted/40 p-4 text-left transition hover:bg-muted/60"
      >
        <DidAvatar did={selfDid} avatarUrl={resolvedAvatarUrl} className="size-14" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{selfProfile?.nickname || selfDid.slice(0, 16)}</p>
          <p className="truncate text-xs text-muted-foreground">{selfDid}</p>
        </div>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <div className="space-y-1 rounded-xl bg-muted/40 p-2">
        <MenuRow
          icon={<PaletteIcon className="size-4" />}
          iconBg="#7c3aed"
          label={t("settings.theme")}
          value={t(`theme.${theme}`)}
          onClick={() => onNavigate("appearance")}
        />
        <MenuRow
          icon={<GlobeIcon className="size-4" />}
          iconBg="#2563eb"
          label={t("settings.language")}
          value={locale.toUpperCase()}
          onClick={() => onNavigate("language")}
        />
        <MenuRow
          icon={<ServerIcon className="size-4" />}
          iconBg="#059669"
          label={t("settings.node")}
          value={nodeUrl ? new URL(nodeUrl).host : ""}
          onClick={() => onNavigate("node")}
        />
      </div>

      <div className="mt-4 rounded-xl bg-muted/40 p-2">
        <MenuRow
          icon={<LogOutIcon className="size-4" />}
          iconBg="#dc2626"
          label={t("settings.disconnect")}
          onClick={onDisconnect}
          destructive
        />
      </div>
    </SettingsShell>
  )
}

/* ─── main settings page ─── */

export function SettingsPage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [view, setView] = useState<SettingsView>(isMobile ? "main" : "profile")

  const disconnect = useConnectionStore((s) => s.disconnect)
  const clearPermissions = usePermissionStore((s) => s.clear)
  const clearSession = useSessionStore((s) => s.clear)
  const viewLabel = useViewLabel(view)

  const onDisconnect = () => {
    disconnect()
    clearPermissions()
    clearSession()
  }

  /* ── mobile: stack-based navigation ── */
  if (isMobile) {
    if (view === "main") {
      return <MobileSettingsMain onNavigate={setView} />
    }
    return <SettingsContent view={view} onBack={() => setView("main")} />
  }

  /* ── desktop: sidebar + content ── */
  return (
    <SidebarProvider className="!min-h-0 h-full flex-1">
      <Sidebar collapsible="none" className="hidden border-r bg-sidebar md:flex">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.view}>
                    <SidebarMenuButton
                      isActive={view === item.view}
                      onClick={() => setView(item.view)}
                    >
                      <item.icon />
                      <span>{t(item.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={onDisconnect} className="text-destructive hover:text-destructive">
                    <LogOutIcon />
                    <span>{t("settings.disconnect")}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="flex h-12 shrink-0 items-center border-b px-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); setView("profile") }}>
                  {t("settings.title")}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{viewLabel}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="flex-1 overflow-y-auto">
          <SettingsContent view={view} />
        </div>
      </main>
    </SidebarProvider>
  )
}
