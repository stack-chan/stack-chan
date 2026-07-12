import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('ImageAvatarLite sample MOD owns its pack assets and license notice', () => {
  const modSource = readFileSync('mods/examples/image_avatar_lite/image-avatar-lite-packs.js', 'utf8')
  assert.match(modSource, /image-avatar-lite-slime/)
  assert.match(modSource, /image-avatar-lite-transparent\.png/)

  const notice = readFileSync('mods/examples/image_avatar_lite/LICENSE-M5Core2ImageAvatarLite_AI.txt', 'utf8')
  assert.match(notice, /MIT License/)
  assert.match(notice, /Copyright \(c\) 2021 Takao Akaki/)
})

test('UI manifests leave ImageAvatarLite sprites to the sample MOD', () => {
  // Bundling the sample MOD's sprites into the host would cost flash space on
  // every build; the MOD ships its own assets.
  for (const manifestPath of ['host/modules/ui/manifest.json', 'host/modules/ui/manifest_wasm.json']) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const alphaResources = (manifest.resources['*-alpha'] ?? []) as string[]
    const colorResources = (manifest.resources['*-color'] ?? []) as string[]
    const combinedResources = (manifest.resources['*'] ?? []) as string[]

    assert.equal(
      [...alphaResources, ...colorResources, ...combinedResources].some((resource) =>
        resource.includes('image-avatar-lite'),
      ),
      false,
      `${manifestPath} should not bundle ImageAvatarLite sample MOD sprites`,
    )
  }
})
