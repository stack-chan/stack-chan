import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  canonicalizeVolume,
  DEFAULT_VOLUME,
  normalizeVolume,
  volumePercentToValue,
  volumeToPercent,
} from './volume-model.js'

test('volume normalization uses a safe fallback and clamps the supported range', () => {
  assert.equal(normalizeVolume(undefined), DEFAULT_VOLUME)
  assert.equal(normalizeVolume(Number.NaN, 0.2), 0.2)
  assert.equal(normalizeVolume(-0.1), 0)
  assert.equal(normalizeVolume(1.1), 1)
})

test('volume conversion exposes an integer percent and round-trips UI selections', () => {
  assert.equal(volumeToPercent(0.456), 46)
  assert.equal(volumePercentToValue(46), 0.46)
  assert.equal(volumePercentToValue(150), 1)
  assert.equal(volumePercentToValue(-20), 0)
  assert.equal(volumePercentToValue(Number.NaN, 0.456), 0.46)
})

test('canonical volume values are stable at one-percent precision', () => {
  assert.equal(canonicalizeVolume(0.104), 0.1)
  assert.equal(canonicalizeVolume(0.105), 0.11)
  assert.equal(canonicalizeVolume('loud', 0.25), 0.25)
})
