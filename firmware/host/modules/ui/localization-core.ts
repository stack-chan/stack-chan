export const SUPPORTED_LOCALES = Object.freeze(['ja', 'en', 'zh-CN'] as const)
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: SupportedLocale = 'ja'

export type LocalizationValue = string | number
export type LocalizationValues = Readonly<Record<string, LocalizationValue>>

export type LocalizationCatalog = {
  get(key: string): string | undefined
}

export type I18nCapability = Readonly<{
  readonly locale: SupportedLocale
  localize: (key: string, values?: LocalizationValues) => string
}>

export function normalizeLocale(value: unknown): SupportedLocale | undefined {
  if (typeof value !== 'string') return undefined
  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0]
  if (language === 'ja') return 'ja'
  if (language === 'en') return 'en'
  if (language === 'zh') return 'zh-CN'
  return undefined
}

export function interpolateLocalizedMessage(message: string, values: LocalizationValues = {}): string {
  return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  )
}

export function resolveLocalizedMessage(
  key: string,
  values: LocalizationValues,
  primaryCatalog?: LocalizationCatalog,
  fallbackCatalog?: LocalizationCatalog,
): string {
  const message = primaryCatalog?.get(key) ?? fallbackCatalog?.get(key) ?? key
  return interpolateLocalizedMessage(message, values)
}
