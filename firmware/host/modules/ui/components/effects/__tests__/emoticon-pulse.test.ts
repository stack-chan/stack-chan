import assert from 'node:assert/strict'
import { test } from 'node:test'

import { packedSpriteColor, spritePulseVariantForFraction } from '../emoticon-pulse.js'

test('sprite pulse variant stays stable across sub-frame ticks', () => {
  assert.equal(spritePulseVariantForFraction(0), 2)
  assert.equal(spritePulseVariantForFraction((2 * Math.PI) / 100), 2)
  assert.equal(spritePulseVariantForFraction((2 * Math.PI * 12) / 100), 3)
})

test('sprite colors are packed as numeric RGBA values at the draw boundary', () => {
  assert.equal(packedSpriteColor(0x123456), 0x123456ff)
  assert.equal(packedSpriteColor(0xffffff, 0x40), 0xffffff40)
})
