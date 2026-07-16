import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

type FontResource = {
  source?: string
  size?: number
  characters?: string
  characterFiles?: string | string[]
}

const manifest = JSON.parse(readFileSync('host/app/manifest.json', 'utf8')) as {
  resources?: { '*-alpha'?: FontResource[] }
}

test('the 24px splash font only bundles glyphs used by the product title', () => {
  const font = manifest.resources?.['*-alpha']?.find(
    (resource) => resource.source === '../modules/ui/assets/fonts/k8x12' && resource.size === 24,
  )

  assert.ok(font, 'expected the k8x12 24px splash font resource')
  assert.equal(font.characters, 'Stack-chan[・＿・]')
  assert.equal(font.characterFiles, undefined)
})
