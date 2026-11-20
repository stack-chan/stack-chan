import assert from 'node:assert/strict'
import { test } from 'node:test'

import { spritePulseVariantForFraction } from '../emoticon-pulse.js'

test('sprite pulse variant stays stable across sub-frame ticks', () => {
  assert.equal(spritePulseVariantForFraction(0), 2)
  assert.equal(spritePulseVariantForFraction((2 * Math.PI) / 100), 2)
  assert.equal(spritePulseVariantForFraction((2 * Math.PI * 12) / 100), 3)
})
