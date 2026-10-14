import { resolveLocalizedMessage } from 'localization-core'
import { Locals } from 'piu/MC'

const catalog = new Locals('locals')
catalog.language = 'ja'
export const i18n = {
  get locale() {
    return catalog.language
  },
  localize(key, values = {}) {
    return resolveLocalizedMessage(key, values, catalog)
  },
}
export function setLocale(locale) {
  catalog.language = locale
}
