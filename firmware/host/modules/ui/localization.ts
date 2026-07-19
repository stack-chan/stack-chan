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
  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0]
  if (language === 'ja') return 'ja'
  if (language === 'en') return 'en'
  if (language === 'zh') return 'zh-CN'
  return undefined
}

export function setLocalizationLanguage(value: unknown): SupportedLocale {
  currentLocale = normalizeLocale(value) ?? DEFAULT_LOCALE
  if (locals) locals.language = currentLocale
  return currentLocale
}

export const initializeLocalization = setLocalizationLanguage

export function getLocalizationLanguage(): SupportedLocale {
  return currentLocale
}

export function localize(key: string, values: InterpolationValues = {}): string {
  const message = getLocals().get(key)
  return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  )
}
