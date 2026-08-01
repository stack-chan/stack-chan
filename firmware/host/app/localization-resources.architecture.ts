import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import * as fontkit from 'fontkit'

const locales = ['ja', 'en', 'zh-CN'] as const
const firmwareRoot = process.cwd()
const catalogs = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(join(firmwareRoot, 'host', 'app', 'strings', `${locale}.json`), 'utf8')) as Record<
      string,
      string
    >,
  ]),
) as Record<(typeof locales)[number], Record<string, string>>

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort()
}

// Firmware resources use stable semantic keys, so placeholder names are an
// explicit contract rather than being embedded in the key text.
const placeholderContracts: Record<string, string[]> = {
  'settings.volumeValue': ['percent'],
  'settings.wifiStatus': ['status'],
  'splash.connecting': ['attempt', 'maxAttempts'],
}

test('firmware localization catalogs have matching keys and placeholders', () => {
  const japaneseKeys = Object.keys(catalogs.ja).sort()
  for (const locale of locales.slice(1)) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), japaneseKeys, `${locale} keys`)
  }
  for (const key of japaneseKeys) {
    for (const locale of locales) {
      assert.deepEqual(placeholders(catalogs[locale][key]), placeholderContracts[key] ?? [], `${locale}: ${key}`)
    }
  }
})

test('the Simplified Chinese UI font covers every localized firmware glyph', () => {
  const font = fontkit.openSync(
    join(firmwareRoot, 'host', 'modules', 'ui', 'assets', 'fonts', 'StackchanCJK-Regular.ttf'),
  )
  const supported = new Set(font.characterSet)
  const required = new Set(
    [
      ...Array.from({ length: 95 }, (_, index) => index + 32),
      ...locales.flatMap((locale) =>
        [...Object.values(catalogs[locale]).join('')].map((character) => character.codePointAt(0)),
      ),
    ].filter(
      (codePoint): codePoint is number => codePoint !== undefined && !/\s/u.test(String.fromCodePoint(codePoint)),
    ),
  )
  const missing = [...required]
    .filter((codePoint) => !supported.has(codePoint))
    .map((codePoint) => String.fromCodePoint(codePoint))
  assert.deepEqual(missing, [])
})
