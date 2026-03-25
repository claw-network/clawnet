import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export type ThemeMode = "dark" | "light"
export type Locale = "en" | "zh"

interface UIStore {
  theme: ThemeMode
  locale: Locale
  detailPanelOpen: boolean
  pollingState: "active" | "idle" | "paused"
  setTheme: (theme: ThemeMode) => void
  setLocale: (locale: Locale) => void
  setDetailPanelOpen: (open: boolean) => void
  setPollingState: (state: UIStore["pollingState"]) => void
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement
  if (theme === "dark") {
    root.classList.add("dark")
  } else {
    root.classList.remove("dark")
  }
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      theme: "dark",
      locale: "en",
      detailPanelOpen: false,
      pollingState: "idle",
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      setLocale: (locale) => {
        set({ locale })
      },
      setDetailPanelOpen: (detailPanelOpen) => {
        set({ detailPanelOpen })
      },
      setPollingState: (pollingState) => {
        set({ pollingState })
      },
    }),
    {
      name: "telagent-webapp-ui",
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        theme: state.theme,
        locale: state.locale,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return
        }
        applyTheme(state.theme)
      },
    },
  ),
)
