import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { Emotion } from '../../../../../state/face-state.js'
import { getImageAvatarPack, IMAGE_AVATAR_PACKS } from '../image-avatar-pack.js'
import { frameIndexForRatio, resolveExpressionName } from '../image-avatar-state.js'

test('demo image avatar pack describes a complete face, mouth, and hands sprite set', () => {
  const pack = getImageAvatarPack('stackchan-demo')

  assert.equal(pack.id, 'stackchan-demo')
  assert.deepEqual(Object.keys(pack.expressions).sort(), ['angry', 'happy', 'normal', 'sad'])

  for (const [expressionName, expression] of Object.entries(pack.expressions)) {
    assert.equal(expression.head.texture, `stackchan-demo-head-${expressionName}.png`)
    assert.equal(expression.mouth.frames.texture, `stackchan-demo-mouth-${expressionName}.png`)
    assert.equal(expression.hands.left.texture, `stackchan-demo-hand-left-${expressionName}.png`)
    assert.equal(expression.hands.right.texture, `stackchan-demo-hand-right-${expressionName}.png`)
    assert.equal(expression.mouth.frames.frameCount, 4)
    assert.equal(expression.eyes.left.blinkFrames.frameCount, 4)
    assert.equal(expression.eyes.right.blinkFrames.frameCount, 4)
  }
})

test('ImageAvatarLite packs live in the sample MOD instead of the host registry', () => {
  assert.equal(getImageAvatarPack('image-avatar-lite-slime'), IMAGE_AVATAR_PACKS['stackchan-demo'])
})

test('image avatar pack lookup falls back to the bundled demo pack', () => {
  assert.equal(getImageAvatarPack(undefined), IMAGE_AVATAR_PACKS['stackchan-demo'])
  assert.equal(getImageAvatarPack('missing-avatar'), IMAGE_AVATAR_PACKS['stackchan-demo'])
})

test('image avatar state helpers clamp ratios and map emotions to expressions', () => {
  assert.equal(frameIndexForRatio(-0.2, 4), 0)
  assert.equal(frameIndexForRatio(0.66, 4), 2)
  assert.equal(frameIndexForRatio(1.5, 4), 3)

  const pack = getImageAvatarPack('stackchan-demo')
  assert.equal(resolveExpressionName(pack, Emotion.HAPPY), 'happy')
  assert.equal(resolveExpressionName(pack, Emotion.ANGRY), 'angry')
  assert.equal(resolveExpressionName(pack, Emotion.DOUBTFUL), 'normal')
})

test('UI manifests keep bundled demo masks but leave ImageAvatarLite sprites to the sample MOD', () => {
  const demoExpected = [
    'stackchan-demo-head-normal',
    'stackchan-demo-eye-left-normal',
    'stackchan-demo-eye-right-normal',
    'stackchan-demo-mouth-normal',
    'stackchan-demo-hand-left-normal',
    'stackchan-demo-hand-right-normal',
  ].map((name) => `./assets/images/faces/image-avatar/stackchan-demo/${name}`)

  for (const manifestPath of ['host/modules/ui/manifest.json', 'host/modules/ui/manifest_wasm.json']) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const alphaResources = manifest.resources['*-alpha'] as string[]
    const colorResources = (manifest.resources['*-color'] ?? []) as string[]
    const combinedResources = (manifest.resources['*'] ?? []) as string[]

    for (const resource of demoExpected) {
      assert.ok(alphaResources.includes(resource), `${manifestPath} missing alpha resource ${resource}`)
    }
    assert.equal(
      [...alphaResources, ...colorResources, ...combinedResources].some((resource) =>
        resource.includes('image-avatar-lite'),
      ),
      false,
      `${manifestPath} should not bundle ImageAvatarLite sample MOD sprites`,
    )
  }

  const modManifest = JSON.parse(readFileSync('mods/examples/image_avatar_lite/manifest.json', 'utf-8'))
  const modResources = modManifest.resources['*'] as string[]
  assert.deepEqual(modResources, ['./assets/*'])
})
