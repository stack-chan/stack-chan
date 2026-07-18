export const SUPPORTED_LOCALES = Object.freeze(['ja', 'en', 'zh-CN'] as const)
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: SupportedLocale = 'ja'

const japanese: Readonly<Record<string, string>> = Object.freeze({
  'boot.wifiNotFound': '保存済みWi-Fiが見つかりません',
  'boot.wifiFailed': 'Wi-Fi接続に失敗しました',
  'status.notConnected': '未接続',
  'status.connected': '接続済み',
  'status.connecting': '接続中',
  'status.scanning': 'スキャン中',
  'status.syncingTime': '時刻同期中',
  'status.reconnecting': '再接続中',
  'status.failed': '接続失敗',
  'status.closed': '終了',
  'status.ready': '準備完了',
  'status.off': 'オフ',
  'status.unknown': '不明',
})

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
  return currentLocale
}

export const initializeLocalization = setLocalizationLanguage

export function getLocalizationLanguage(): SupportedLocale {
  return currentLocale
}

export function localize(key: string, values: Record<string, string | number> = {}): string {
  const message = currentLocale === 'ja' ? (japanese[key] ?? key) : key
  return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  )
}
