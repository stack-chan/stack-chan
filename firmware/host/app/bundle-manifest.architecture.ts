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

type FontManifest = {
  build?: { NAME?: string }
  resources?: { '*-alpha'?: FontResource[]; '*-mask'?: Array<string | FontResource> }
}

const manifest = JSON.parse(readFileSync('host/app/manifest.json', 'utf8')) as FontManifest
const wasmManifest = JSON.parse(readFileSync('host/app/manifest_wasm.json', 'utf8')) as FontManifest
const splashTestManifest = JSON.parse(
  readFileSync('host/modules/ui/views/splash/__tests__/startup-splash/manifest.test.json', 'utf8'),
) as FontManifest
const appBarTestManifest = JSON.parse(
  readFileSync('host/modules/ui/components/status-bar/__tests__/chat-status-bar/manifest.test.json', 'utf8'),
) as FontManifest

function findFont(
  resources: Array<string | FontResource> | undefined,
  predicate: (resource: FontResource) => boolean,
): FontResource | undefined {
  return resources?.find((resource): resource is FontResource => typeof resource !== 'string' && predicate(resource))
}

function requireFontCharacters(manifest: FontManifest, label: string): string {
  const font = findFont(manifest.resources?.['*-alpha'], (resource) => resource.size === 24)
  assert.ok(font, `expected the ${label} 24px font resource`)
  assert.equal(typeof font.characters, 'string', `expected the ${label} font to declare its rendered characters`)
  return font.characters as string
}

function sortedGlyphs(characters: string): string[] {
  return [...new Set(characters)].sort()
}

test('host manifests use a stable application name', () => {
  assert.equal(manifest.build?.NAME, 'stack-chan-host')
  assert.equal(wasmManifest.build?.NAME, 'stack-chan-host')
})

test('the 24px font bundles glyphs used by the splash title and AppBar clock', () => {
  const font = findFont(
    manifest.resources?.['*-alpha'],
    (resource) => resource.source === '../modules/ui/assets/fonts/k8x12' && resource.size === 24,
  )

  assert.ok(font, 'expected the k8x12 24px host font resource')
  assert.equal(typeof font.characters, 'string')
  assert.equal(font.characterFiles, undefined)
  const requiredCharacters = requireFontCharacters(splashTestManifest, 'startup splash')
  const appBarCharacters = requireFontCharacters(appBarTestManifest, 'AppBar')
  assert.deepEqual(sortedGlyphs(font.characters as string), sortedGlyphs(requiredCharacters + appBarCharacters))

  const wasmFont = findFont(
    wasmManifest.resources?.['*-alpha'],
    (resource) => resource.source === '../modules/ui/assets/fonts/k8x12' && resource.size === 24,
  )
  assert.ok(wasmFont, 'expected the WASM k8x12 24px host font resource')
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
