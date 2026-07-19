import assert from 'node:assert/strict'
import test from 'node:test'
import {
  interpolateLocalizedMessage,
  type LocalizationCatalog,
  normalizeLocale,
  resolveLocalizedMessage,
} from './localization-core.js'

function catalog(messages: Readonly<Record<string, string>>): LocalizationCatalog {
  return {
    get(key) {
      return messages[key]
    },
  }
}

test('normalizes supported language tags to firmware locales', () => {
  assert.equal(normalizeLocale('ja-JP'), 'ja')
  assert.equal(normalizeLocale('EN_us'), 'en')
  assert.equal(normalizeLocale('zh-Hans-CN'), 'zh-CN')
  assert.equal(normalizeLocale('fr'), undefined)
  assert.equal(normalizeLocale(undefined), undefined)
})

test('interpolates named values without removing unknown placeholders', () => {
  assert.equal(
    interpolateLocalizedMessage('{name}: {count} / {missing}', { name: 'Stack-chan', count: 3 }),
    'Stack-chan: 3 / {missing}',
  )
})

test('resolves MOD messages before host messages', () => {
  const modCatalog = catalog({ shared: 'MOD', 'sample.only': 'MOD only' })
  const hostCatalog = catalog({ shared: 'Host', 'host.only': 'Host only' })

  assert.equal(resolveLocalizedMessage('shared', {}, modCatalog, hostCatalog), 'MOD')
  assert.equal(resolveLocalizedMessage('sample.only', {}, modCatalog, hostCatalog), 'MOD only')
})

test('falls back from the MOD catalog to the host catalog and then the key', () => {
  const modCatalog = catalog({})
  const hostCatalog = catalog({ 'host.only': 'Host only' })

  assert.equal(resolveLocalizedMessage('host.only', {}, modCatalog, hostCatalog), 'Host only')
  assert.equal(resolveLocalizedMessage('unknown.key', {}, modCatalog, hostCatalog), 'unknown.key')
})
