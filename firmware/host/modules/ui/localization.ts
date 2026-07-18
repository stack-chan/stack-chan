import { Locals } from 'piu/MC'

export const SUPPORTED_LOCALES = Object.freeze(['ja', 'en', 'zh-CN'] as const)
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: SupportedLocale = 'ja'

type InterpolationValue = string | number
type InterpolationValues = Record<string, InterpolationValue>

let currentLocale: SupportedLocale = DEFAULT_LOCALE
let locals: Locals | undefined

function getLocals(): Locals {
  if (!locals) {
    // Construct Locals only after the application starts. Creating this native
    // object while xsl links preloaded modules is unsupported by some targets.
    locals = new Locals('locals')
    locals.language = currentLocale
  }
  return locals
}

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
  if (locals) locals.language = currentLocale
  return currentLocale
}

export function initializeLocalization(value: unknown): SupportedLocale {
  return setLocalizationLanguage(value)
}

export function getLocalizationLanguage(): SupportedLocale {
  return currentLocale
}

export function localize(key: string, values: InterpolationValues = {}): string {
  const message = getLocals().get(key)
  return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  )
}
