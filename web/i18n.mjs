export const SUPPORTED_LOCALES = Object.freeze(['ja', 'en', 'zh-CN'])
export const DEFAULT_LOCALE = 'ja'
export const LOCALE_STORAGE_KEY = 'stackchan.locale'

let activeLocale = DEFAULT_LOCALE
let japaneseCatalog = Object.freeze({})
let activeCatalog = Object.freeze({})
let templateEntries = []
let observer

function hasBrowserStorage() {
  return typeof globalThis.localStorage !== 'undefined'
}

function storedLocale() {
  if (!hasBrowserStorage()) return null
  try {
    return globalThis.localStorage.getItem(LOCALE_STORAGE_KEY)
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rebuildTemplateEntries() {
  templateEntries = Object.keys(japaneseCatalog)
    .filter((key) => /\{[A-Za-z][A-Za-z0-9_]*\}/.test(key))
    .map((key) => {
      const names = []
      let cursor = 0
      let pattern = '^'
      for (const match of key.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
        pattern += escapeRegExp(key.slice(cursor, match.index)) + '([\\s\\S]+?)'
        names.push(match[1])
        cursor = match.index + match[0].length
      }
      pattern += `${escapeRegExp(key.slice(cursor))}$`
      return { key, names, pattern: new RegExp(pattern) }
    })
}

function interpolate(value, params) {
  return String(value).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder
  )
}

function translateRenderedString(source) {
  for (const entry of templateEntries) {
    const match = entry.pattern.exec(source)
    if (!match) continue
    const params = Object.fromEntries(entry.names.map((name, index) => [name, match[index + 1]]))
    return interpolate(activeCatalog[entry.key] ?? japaneseCatalog[entry.key] ?? entry.key, params)
  }
  return source
}

export function t(source, params = {}) {
  const translated = activeCatalog[source] ?? japaneseCatalog[source]
  if (translated !== undefined) return interpolate(translated, params)
  if (Object.keys(params).length > 0) return interpolate(source, params)
  return translateRenderedString(source)
}

export function getLocale() {
  return activeLocale
}

const SKIPPED_TEXT_PARENTS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE'])
const TRANSLATED_ATTRIBUTES = ['aria-label', 'placeholder', 'title']

function translateTextNode(node) {
  if (
    !node.parentElement ||
    SKIPPED_TEXT_PARENTS.has(node.parentElement.tagName) ||
    node.parentElement.closest('[translate="no"]')
  )
    return
  const source = node.nodeValue ?? ''
  const trimmed = source.trim()
  if (!trimmed) return
  const translated = t(trimmed)
  if (translated === trimmed) return
  const start = source.indexOf(trimmed)
  node.nodeValue = `${source.slice(0, start)}${translated}${source.slice(start + trimmed.length)}`
}

function translateElementAttributes(element) {
  if (element.closest('[translate="no"]')) return
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const source = element.getAttribute(attribute)
    if (!source) continue
    const translated = t(source)
    if (translated !== source) element.setAttribute(attribute, translated)
  }
}

export function translateDocument(root = globalThis.document) {
  if (!root || typeof NodeFilter === 'undefined') return
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root)
    return
  }
  if (root instanceof Element) translateElementAttributes(root)
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (textWalker.nextNode()) translateTextNode(textWalker.currentNode)
  const elementWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  while (elementWalker.nextNode()) translateElementAttributes(elementWalker.currentNode)
}

function startObserver() {
  if (observer || typeof MutationObserver === 'undefined' || !document.documentElement) return
  observer = new MutationObserver((records) => {
    observer.disconnect()
    try {
      for (const record of records) {
        if (record.type === 'characterData') translateTextNode(record.target)
        else if (record.type === 'attributes') translateElementAttributes(record.target)
        else for (const node of record.addedNodes) translateDocument(node)
      }
    } finally {
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: TRANSLATED_ATTRIBUTES,
      })
    }
  })
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATED_ATTRIBUTES,
  })
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
    translateDocument(document)
    startObserver()
    document.dispatchEvent(new CustomEvent('stackchan:localechange', { detail: { locale: activeLocale } }))
  }
  return activeLocale
}

export async function setLocale(locale, options = {}) {
  const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE
  if (hasBrowserStorage()) {
    try {
      globalThis.localStorage.setItem(LOCALE_STORAGE_KEY, normalized)
    } catch {}
  }
  return initializeI18n({ ...options, locale: normalized })
}

export const i18nReady = typeof document === 'undefined' ? Promise.resolve(DEFAULT_LOCALE) : initializeI18n()
