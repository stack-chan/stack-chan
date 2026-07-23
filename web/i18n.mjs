export const SUPPORTED_LOCALES = Object.freeze(['ja', 'en', 'zh-CN'])
export const DEFAULT_LOCALE = 'ja'
export const LOCALE_STORAGE_KEY = 'stackchan.locale'

let activeLocale = DEFAULT_LOCALE
let japaneseCatalog = Object.freeze({})
let activeCatalog = Object.freeze({})
let templateEntries = []

function storedLocale() {
  try {
    return globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function normalizeLocale(locale) {
  if (typeof locale !== 'string') return null
  const normalized = locale.trim().replaceAll('_', '-').toLowerCase()
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  return null
}

export function resolveLocale({ stored = storedLocale(), browser = globalThis.navigator?.languages ?? [] } = {}) {
  const explicit = normalizeLocale(stored)
  if (explicit) return explicit
  for (const candidate of browser) {
    const matched = normalizeLocale(candidate)
    if (matched) return matched
  }
  return DEFAULT_LOCALE
}

async function defaultCatalogLoader(locale) {
  const response = await fetch(new URL(`./locales/${locale}.json`, import.meta.url))
  if (!response.ok) throw new Error(`Unable to load locale ${locale}: HTTP ${response.status}`)
  return response.json()
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const interpolate = (value, params) =>
  String(value).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder
  )

function rebuildTemplateEntries() {
  templateEntries = Object.keys(japaneseCatalog)
    .filter((key) => /\{[A-Za-z][A-Za-z0-9_]*\}/.test(key))
    .map((key) => {
      const names = []
      let cursor = 0
      let pattern = '^'
      for (const match of key.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
        pattern += `${escapeRegExp(key.slice(cursor, match.index))}([\\s\\S]+?)`
        names.push(match[1])
        cursor = match.index + match[0].length
      }
      pattern += `${escapeRegExp(key.slice(cursor))}$`
      return { key, names, pattern: new RegExp(pattern) }
    })
}

export function t(source, params = {}) {
  const translated = activeCatalog[source] ?? japaneseCatalog[source]
  if (translated !== undefined) return interpolate(translated, params)
  if (Object.keys(params).length > 0) return interpolate(source, params)
  for (const entry of templateEntries) {
    const match = entry.pattern.exec(source)
    if (!match) continue
    const renderedParams = Object.fromEntries(entry.names.map((name, index) => [name, match[index + 1]]))
    return interpolate(activeCatalog[entry.key] ?? japaneseCatalog[entry.key] ?? entry.key, renderedParams)
  }
  return source
}

export function getLocale() {
  return activeLocale
}

export async function initializeI18n({ locale = resolveLocale(), loader = defaultCatalogLoader } = {}) {
  const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE
  try {
    japaneseCatalog = Object.freeze(await loader(DEFAULT_LOCALE))
  } catch (error) {
    console.warn('[i18n] Japanese catalog is unavailable', error)
    japaneseCatalog = Object.freeze({})
  }
  if (normalized === DEFAULT_LOCALE) {
    activeLocale = DEFAULT_LOCALE
    activeCatalog = japaneseCatalog
  } else {
    try {
      activeCatalog = Object.freeze(await loader(normalized))
      activeLocale = normalized
    } catch (error) {
      console.warn(`[i18n] ${normalized} catalog is unavailable; using Japanese`, error)
      activeLocale = DEFAULT_LOCALE
      activeCatalog = japaneseCatalog
    }
  }
  rebuildTemplateEntries()
  if (typeof document !== 'undefined') {
    document.documentElement.lang = activeLocale
    document.dispatchEvent(new CustomEvent('stackchan:localechange', { detail: { locale: activeLocale } }))
  }
  return activeLocale
}

export async function setLocale(locale, options = {}) {
  const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, normalized)
  } catch {
    // Storage may be disabled without preventing a live locale change.
  }
  return initializeI18n({ ...options, locale: normalized })
}

export const i18nReady = typeof document === 'undefined' ? Promise.resolve(DEFAULT_LOCALE) : initializeI18n()
