import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { type Locale } from '@/lib/i18n/catalogs'
import { LOCALE_STORAGE_KEY, normalizeLocale, resolveLocale } from '@/lib/i18n/locale'
import { translate } from '@/lib/i18n/translate'

type Translate = (source: string, params?: Record<string, unknown>) => string

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(() => resolveLocale())

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((nextLocale: Locale) => {
    const normalized = normalizeLocale(nextLocale) ?? 'ja'
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, normalized)
    } catch {
      // A blocked storage backend must not prevent changing the live language.
    }
    updateLocale(normalized)
  }, [])

  const t = useCallback<Translate>((source, params = {}) => translate(locale, source, params), [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = () => {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
