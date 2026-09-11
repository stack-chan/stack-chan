import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import type { ImageAvatarPack } from '../../../../../../../../sdk/image-avatar.js'

test('every sample avatar sprite fits an owned PNG resource and the license notice is retained', async () => {
  const directory = 'mods/examples/image_avatar_lite'
  const module = await import(pathToFileURL(resolve(directory, 'image-avatar-lite-packs.js')).href)
  const packs = module.IMAGE_AVATAR_LITE_PACKS as Record<string, ImageAvatarPack>
  const textures = new Set<string>()
  for (const [id, pack] of Object.entries(packs)) {
    assert.equal(pack.id, id)
    assert.ok(Object.hasOwn(pack.expressions, pack.defaultExpression))
    for (const expression of Object.values(pack.expressions)) {
      for (const sprite of [
        expression.head,
        expression.eyes.left,
        expression.eyes.right,
        expression.mouth,
        expression.hands.left,
        expression.hands.right,
      ]) {
        textures.add(sprite.texture)
        const bytes = readFileSync(resolve(directory, 'assets', sprite.texture))
        const frames = 'frameCount' in sprite ? (sprite.frameCount as number) : 1
        assert.equal(bytes.readUInt32BE(16), sprite.width * frames, `${id}: ${sprite.texture} width`)
        assert.equal(bytes.readUInt32BE(20), sprite.height, `${id}: ${sprite.texture} height`)
      }
    }
  }
  assert.deepEqual(
    [...textures].sort(),
    readdirSync(resolve(directory, 'assets'))
      .filter((name) => name.endsWith('.png'))
      .sort(),
  )
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
    const maskResources = (manifest.resources['*-mask'] ?? []) as string[]
    const colorResources = (manifest.resources['*-color'] ?? []) as string[]
    const combinedResources = (manifest.resources['*'] ?? []) as string[]

    assert.equal(
      [...alphaResources, ...maskResources, ...colorResources, ...combinedResources].some((resource) =>
        resource.includes('image-avatar-lite'),
      ),
      false,
      `${manifestPath} should not bundle ImageAvatarLite sample MOD sprites`,
    )
  }
})
