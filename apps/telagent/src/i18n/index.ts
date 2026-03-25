import i18next from "i18next"
import { initReactI18next } from "react-i18next"

import en from "./locales/en.json"
import zh from "./locales/zh.json"

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
})

export { i18next }
