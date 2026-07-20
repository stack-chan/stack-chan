import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

type FontResource = {
  source?: string
  name?: string
  size?: number
  characters?: string
  characterFiles?: string | string[]
  blocks?: string[]
  localization?: boolean
}

const manifest = JSON.parse(readFileSync('host/app/manifest.json', 'utf8')) as {
  build?: { NAME?: string }
  resources?: { '*-alpha'?: FontResource[]; '*-mask'?: Array<string | FontResource> }
}
const wasmManifest = JSON.parse(readFileSync('host/app/manifest_wasm.json', 'utf8')) as {
  build?: { NAME?: string }
  resources?: { '*-alpha'?: FontResource[]; '*-mask'?: Array<string | FontResource> }
}

function findFont(
  resources: Array<string | FontResource> | undefined,
  predicate: (resource: FontResource) => boolean,
): FontResource | undefined {
  return resources?.find((resource): resource is FontResource => typeof resource !== 'string' && predicate(resource))
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

  const wasmFont = findFont(
    wasmManifest.resources?.['*-alpha'],
    (resource) => resource.source === '../modules/ui/assets/fonts/k8x12' && resource.size === 24,
  )
  assert.ok(wasmFont, 'expected the WASM k8x12 24px splash font resource')
  assert.equal(wasmFont.characters, font.characters)
  assert.equal(wasmFont.characterFiles, undefined)
})

test('the CJK font bundles only glyphs used by localization catalogs', () => {
  const font = findFont(manifest.resources?.['*-mask'], (resource) => resource.name === 'StackchanCJK')

  assert.ok(font, 'expected the StackchanCJK font resource')
  assert.equal(font.localization, true)
  assert.equal(font.characters, ' ')
  assert.deepEqual(font.blocks, [])

  const wasmFont = findFont(wasmManifest.resources?.['*-mask'], (resource) => resource.name === 'StackchanCJK')
  assert.ok(wasmFont, 'expected the WASM StackchanCJK font resource')
  assert.equal(wasmFont.localization, font.localization)
  assert.equal(wasmFont.characters, font.characters)
  assert.deepEqual(wasmFont.blocks, font.blocks)
})
