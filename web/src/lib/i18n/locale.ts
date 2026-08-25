import { type Locale } from './catalogs'

export const LOCALE_STORAGE_KEY = 'stackchan.locale'
export const DEFAULT_LOCALE: Locale = 'ja'

export const normalizeLocale = (locale: unknown): Locale | null => {
  if (typeof locale !== 'string') return null
  const normalized = locale.trim().replaceAll('_', '-').toLowerCase()
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  return null
}

const storedLocale = () => {
  try {
    return globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export const resolveLocale = ({
  stored = storedLocale(),
  browser = globalThis.navigator?.languages ?? [],
}: {
  stored?: string | null
  browser?: readonly string[]
} = {}): Locale => {
  const explicit = normalizeLocale(stored)
  if (explicit) return explicit
  for (const candidate of browser) {
    const matched = normalizeLocale(candidate)
    if (matched) return matched
  }
  return DEFAULT_LOCALE
}
