import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  quantizeUnit,
  rememberCachedValue,
  SHAPE_CACHE_ENTRY_LIMIT,
  UNIT_OPEN_STEPS,
  unitFromStep,
} from '../shape-cache.js'

test('shape animation open ratios use a bounded display-quality step count', () => {
  assert.equal(UNIT_OPEN_STEPS, 12)
  assert.equal(quantizeUnit(0), 0)
  assert.equal(quantizeUnit(1), 12)
  assert.equal(quantizeUnit(0.5), 6)
  assert.equal(unitFromStep(6), 0.5)
})

test('rememberCachedValue evicts the oldest entry when the cache reaches its limit', () => {
  const cache = new Map<string, number>()
  assert.equal(rememberCachedValue(cache, 'oldest', 1, 2), 1)
  rememberCachedValue(cache, 'middle', 2, 2)
  rememberCachedValue(cache, 'newest', 3, 2)

  assert.equal(cache.size, 2)
  assert.equal(cache.has('oldest'), false)
  assert.equal(cache.get('middle'), 2)
  assert.equal(cache.get('newest'), 3)
  assert.equal(SHAPE_CACHE_ENTRY_LIMIT, 128)
})
