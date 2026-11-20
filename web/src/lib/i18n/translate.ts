import { catalogs, type Catalog, type Locale } from './catalogs'

type Params = Record<string, unknown>

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const templateEntries = Object.keys(catalogs.ja)
  .filter((key) => /\{[A-Za-z][A-Za-z0-9_]*\}/.test(key))
  .map((key) => {
    const names: string[] = []
    let cursor = 0
    let pattern = '^'
    for (const match of key.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
      pattern += `${escapeRegExp(key.slice(cursor, match.index))}([\\s\\S]+?)`
      names.push(match[1])
      cursor = (match.index ?? 0) + match[0].length
    }
    pattern += `${escapeRegExp(key.slice(cursor))}$`
    return { key, names, pattern: new RegExp(pattern) }
  })

const interpolate = (value: string, params: Params) =>
  value.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder
  )

const matchRenderedTemplate = (source: string, catalog: Catalog) => {
  for (const entry of templateEntries) {
    const match = entry.pattern.exec(source)
    if (!match) continue
    const params = Object.fromEntries(entry.names.map((name, index) => [name, match[index + 1]]))
    return interpolate(catalog[entry.key] ?? catalogs.ja[entry.key] ?? entry.key, params)
  }
  return source
}

export const translate = (locale: Locale, source: string, params: Params = {}) => {
  const catalog = catalogs[locale]
  const translated = catalog[source] ?? catalogs.ja[source]
  if (translated !== undefined) return interpolate(translated, params)
  if (Object.keys(params).length > 0) return interpolate(source, params)
  return matchRenderedTemplate(source, catalog)
}
