import Resource from 'Resource'
import {
  DEFAULT_LOCALE,
  type I18nCapability,
  type LocalizationValues,
  normalizeLocale,
  resolveLocalizedMessage,
} from 'localization-core'
import { Locals } from 'piu/MC'

export {
  DEFAULT_LOCALE,
  type I18nCapability,
  type LocalizationValue,
  type LocalizationValues,
  normalizeLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from 'localization-core'

type SupportedLocale = I18nCapability['locale']

let currentLocale: SupportedLocale = DEFAULT_LOCALE
let hostLocals: Locals | undefined
let modLocals: Locals | undefined
let hasModLocals: boolean | undefined

function getHostLocals(): Locals {
  if (!hostLocals) {
    // Construct Locals only after the application starts. Creating this native
    // object while xsl links preloaded modules is unsupported by some targets.
    hostLocals = new Locals('locals')
    hostLocals.language = currentLocale
  }
  return hostLocals
}

function getModLocals(): Locals | undefined {
  if (hasModLocals === undefined) {
    // mcrun names MOD localization resources "modLocals". Locals currently
    // constructs with English before its language setter can be used, so both
    // the index and English table must be present.
    hasModLocals = Resource.exists('modLocals.mhi') && Resource.exists('modLocals.en.mhr')
  }
  if (!hasModLocals || !Resource.exists(`modLocals.${currentLocale}.mhr`)) return undefined

  if (!modLocals) modLocals = new Locals('modLocals')
  if (modLocals.language !== currentLocale) modLocals.language = currentLocale
  return modLocals
}

export function setLocalizationLanguage(value: unknown): SupportedLocale {
  currentLocale = normalizeLocale(value) ?? DEFAULT_LOCALE
  if (hostLocals) hostLocals.language = currentLocale
  return currentLocale
}

export const initializeLocalization = setLocalizationLanguage

export function getLocalizationLanguage(): SupportedLocale {
  return currentLocale
}

export function localize(key: string, values: LocalizationValues = {}): string {
  return resolveLocalizedMessage(key, values, undefined, getHostLocals())
}

function localizeForContext(key: string, values: LocalizationValues = {}): string {
  return resolveLocalizedMessage(key, values, getModLocals(), getHostLocals())
}

export function createI18nCapability(): I18nCapability {
  return Object.freeze({
    get locale() {
      return currentLocale
    },
    localize: localizeForContext,
  })
}
