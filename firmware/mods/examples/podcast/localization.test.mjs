import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as fontkit from 'fontkit'

const locales = ['ja', 'en', 'zh-CN']
const catalogs = locales.map((locale) => JSON.parse(readFileSync(new URL(`./strings/${locale}.json`, import.meta.url))))
const placeholders = (message) => [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort()

test('Podcast catalogs agree on message keys and interpolation parameters', () => {
  const keys = Object.keys(catalogs[0]).sort()
  for (const [index, catalog] of catalogs.entries()) {
    assert.deepEqual(Object.keys(catalog).sort(), keys, locales[index])
    for (const key of keys)
      assert.deepEqual(placeholders(catalog[key]), placeholders(catalogs[0][key]), `${locales[index]}: ${key}`)
  }
})

test('Podcast Chinese font and bitmap character list cover catalogs and selection mark', () => {
  const font = fontkit.openSync(
    new URL('../../../host/modules/ui/assets/fonts/StackchanCJK-Regular.ttf', import.meta.url).pathname,
  )
  const supported = new Set(font.characterSet)
  const bitmapCharacters = new Set(readFileSync(new URL('./assets/PodcastCJK-chars.txt', import.meta.url), 'utf8'))
  const required = new Set(
    [...catalogs.flatMap((catalog) => Object.values(catalog)).join(''), '●'].filter(
      (character) => !/\s/u.test(character),
    ),
  )
  assert.deepEqual(
    [...required].filter((character) => !supported.has(character.codePointAt(0))),
    [],
  )
  assert.deepEqual(
    [...required].filter((character) => !bitmapCharacters.has(character)),
    [],
  )
})
