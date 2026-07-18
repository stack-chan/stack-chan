import { Locals } from 'piu/MC'

export const SUPPORTED_LOCALES = Object.freeze(['ja', 'en', 'zh-CN'] as const)
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: SupportedLocale = 'ja'

type InterpolationValue = string | number
type InterpolationValues = Record<string, InterpolationValue>

// Set the language through the documented accessor after construction. Some
// Moddable SDK revisions read the first constructor argument for both fields.
const locals = new Locals('locals')
locals.language = DEFAULT_LOCALE
let currentLocale: SupportedLocale = DEFAULT_LOCALE

export function normalizeLocale(value: unknown): SupportedLocale | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replaceAll('_', '-').toLowerCase()
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  return undefined
}

export function setLocalizationLanguage(value: unknown): SupportedLocale {
  currentLocale = normalizeLocale(value) ?? DEFAULT_LOCALE
  locals.language = currentLocale
  return currentLocale
}

export function initializeLocalization(value: unknown): SupportedLocale {
  return setLocalizationLanguage(value)
}

export function getLocalizationLanguage(): SupportedLocale {
  return currentLocale
}

export function localize(key: string, values: InterpolationValues = {}): string {
  const message = locals.get(key)
  return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  )
}
