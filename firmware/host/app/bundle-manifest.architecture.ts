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
  build?: { NAME?: string }
  resources?: { '*-alpha'?: FontResource[] }
}
const wasmManifest = JSON.parse(readFileSync('host/app/manifest_wasm.json', 'utf8')) as {
  build?: { NAME?: string }
}

test('host manifests use a stable application name', () => {
  assert.equal(manifest.build?.NAME, 'stack-chan-host')
  assert.equal(wasmManifest.build?.NAME, 'stack-chan-host')
})

test('the 24px splash font only bundles glyphs used by the product title', () => {
  const font = manifest.resources?.['*-alpha']?.find(
    (resource) => resource.source === '../modules/ui/assets/fonts/k8x12' && resource.size === 24,
  )

  assert.ok(font, 'expected the k8x12 24px splash font resource')
  assert.equal(font.characters, 'Stack-chan[・＿・]')
  assert.equal(font.characterFiles, undefined)
})
