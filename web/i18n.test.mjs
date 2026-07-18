import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  DEFAULT_LOCALE,
  getLocale,
  initializeI18n,
  normalizeLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
  t,
} from './i18n.mjs'

const catalog = async (locale) => JSON.parse(await readFile(new URL(`./locales/${locale}.json`, import.meta.url)))
const placeholders = (value) =>
  [...String(value).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort()

test('locale negotiation accepts BCP 47 variants and falls back to Japanese', () => {
  assert.equal(normalizeLocale('ja-JP'), 'ja')
  assert.equal(normalizeLocale('en_US'), 'en')
  assert.equal(normalizeLocale('zh-Hans-CN'), 'zh-CN')
  assert.equal(normalizeLocale('fr-FR'), null)
  assert.equal(resolveLocale({ stored: 'en-GB', browser: ['zh-CN'] }), 'en')
  assert.equal(resolveLocale({ stored: null, browser: ['fr-FR', 'zh-TW'] }), 'zh-CN')
  assert.equal(resolveLocale({ stored: null, browser: ['fr-FR'] }), DEFAULT_LOCALE)
})

test('all web catalogs expose the same keys and interpolation placeholders', async () => {
  const catalogs = Object.fromEntries(
    await Promise.all(SUPPORTED_LOCALES.map(async (locale) => [locale, await catalog(locale)]))
  )
  const japaneseKeys = Object.keys(catalogs.ja).sort()
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), japaneseKeys, `${locale} should have the same keys as ja`)
    for (const key of japaneseKeys) {
      assert.equal(typeof catalogs[locale][key], 'string', `${locale}:${key} should be a string`)
      assert.deepEqual(
        placeholders(catalogs[locale][key]),
        placeholders(key),
        `${locale}:${key} should preserve placeholders`
      )
    }
  }
})

test('catalog lookup translates direct and rendered template strings', async () => {
  const catalogs = {
    ja: {
      接続済み: '接続済み',
      '接続できませんでした: {error}': '接続できませんでした: {error}',
    },
    en: {
      接続済み: 'Connected',
      '接続できませんでした: {error}': 'Could not connect: {error}',
    },
  }
  await initializeI18n({ locale: 'en-US', loader: async (locale) => catalogs[locale] })
  assert.equal(getLocale(), 'en')
  assert.equal(t('接続済み'), 'Connected')
  assert.equal(t('接続できませんでした: {error}', { error: 'timeout' }), 'Could not connect: timeout')
  assert.equal(t('接続できませんでした: timeout'), 'Could not connect: timeout')
  await initializeI18n({ locale: 'ja', loader: async (locale) => catalogs[locale] })
})
