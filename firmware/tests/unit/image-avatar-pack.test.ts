import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { getImageAvatarPack, IMAGE_AVATAR_PACKS } from '../../stackchan/renderers-piu/parts/image/image-avatar-pack.js'
import {
  frameIndexForRatio,
  resolveExpressionName,
} from '../../stackchan/renderers-piu/parts/image/image-avatar-state.js'

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

test('imported ImageAvatarLite packs are registered with bundled MIT notice', () => {
  const slime = getImageAvatarPack('image-avatar-lite-slime')
  assert.equal(slime.width, 320)
  assert.equal(slime.height, 240)
  assert.deepEqual(Object.keys(slime.expressions).sort(), ['angry', 'normal', 'sad'])
  assert.equal(slime.expressions.normal.mouth.frames.frameCount, 2)
  assert.equal(slime.expressions.normal.eyes.left.blinkFrames.frameCount, 2)
  assert.equal(slime.expressions.normal.hands.left.texture, 'image-avatar-lite-transparent.png')

  const notice = readFileSync(
    'stackchan/assets/images/faces/image-avatar/image-avatar-lite/LICENSE-M5Core2ImageAvatarLite_AI.txt',
    'utf8',
  )
  assert.match(notice, /MIT License/)
  assert.match(notice, /Copyright \(c\) 2021 Takao Akaki/)
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
  assert.equal(resolveExpressionName(pack, 'HAPPY'), 'happy')
  assert.equal(resolveExpressionName(pack, 'ANGRY'), 'angry')
  assert.equal(resolveExpressionName(pack, 'DOUBTFUL'), 'normal')
})

test('WASM renderer manifest bundles demo masks and imported full-color ImageAvatarLite sprites', () => {
  const manifest = JSON.parse(readFileSync('stackchan/renderers-piu/manifest_wasm_renderer_piu.json', 'utf8'))
  const alphaResources = manifest.resources['*-alpha'] as string[]
  const colorResources = manifest.resources['*-color'] as string[]
  const demoExpected = [
    'stackchan-demo-head-normal',
    'stackchan-demo-eye-left-normal',
    'stackchan-demo-eye-right-normal',
    'stackchan-demo-mouth-normal',
    'stackchan-demo-hand-left-normal',
    'stackchan-demo-hand-right-normal',
  ].map((name) => `../assets/images/faces/image-avatar/stackchan-demo/${name}`)
  const importedExpected = [
    'image-avatar-lite-transparent',
    'image-avatar-lite-slime-head',
    'image-avatar-lite-slime-eye-left-normal',
    'image-avatar-lite-slime-eye-right-normal',
    'image-avatar-lite-slime-mouth-normal',
  ].map((name) => `../assets/images/faces/image-avatar/image-avatar-lite/${name}`)

  for (const resource of demoExpected) {
    assert.ok(alphaResources.includes(resource), `missing alpha resource ${resource}`)
  }
  for (const resource of importedExpected) {
    assert.ok(colorResources.includes(resource), `missing color resource ${resource}`)
    assert.ok(!alphaResources.includes(resource), `full-color sprite must not be alpha-only ${resource}`)
  }
})
