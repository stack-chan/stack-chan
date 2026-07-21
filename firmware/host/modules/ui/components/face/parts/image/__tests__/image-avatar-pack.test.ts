import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Emotion } from '../../../../../state/face-state.js'
import { getImageAvatarPack, IMAGE_AVATAR_PACKS, registerImageAvatarPack } from '../image-avatar-pack.js'
import { frameIndexForRatio, resolveExpressionName } from '../image-avatar-state.js'

test('ImageAvatarLite packs live in the sample MOD instead of the host registry', () => {
  assert.equal(getImageAvatarPack('image-avatar-lite-slime'), IMAGE_AVATAR_PACKS['stackchan-demo'])
})

test('MODs can register image avatar packs by id', () => {
  const pack = {
    ...IMAGE_AVATAR_PACKS['stackchan-demo'],
    id: 'test-registered-avatar',
    displayName: 'Test registered avatar',
  }

  assert.equal(registerImageAvatarPack(pack), pack)
  assert.equal(getImageAvatarPack('test-registered-avatar'), pack)
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
