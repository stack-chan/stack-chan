import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clampMouthOpenRatio,
  isMouthOpenRatio,
  isNonNegativeSeconds,
  isNormalizedGain,
  milliseconds,
  mouthOpenRatio,
  normalizedGain,
  radians,
  seconds,
  secondsToCentiseconds,
  secondsToMilliseconds,
} from './domain-values.js'

test('seconds and milliseconds accept non-negative finite numbers and reject negatives or NaN', () => {
  assert.equal(seconds(0), 0)
  assert.equal(seconds(0.5), 0.5)
  assert.equal(milliseconds(150), 150)
  assert.equal(isNonNegativeSeconds(1.25), true)
  assert.equal(isNonNegativeSeconds(-0.1), false)
  assert.throws(() => seconds(-1), RangeError)
  assert.throws(() => seconds(Number.NaN), RangeError)
  assert.throws(() => seconds(Number.POSITIVE_INFINITY), RangeError)
  assert.throws(() => milliseconds(-5), RangeError)
})

test('radians validates finiteness while allowing signed angles', () => {
  assert.equal(radians(-Math.PI), -Math.PI)
  assert.equal(radians(Math.PI / 6), Math.PI / 6)
  assert.throws(() => radians(Number.NaN), RangeError)
  assert.throws(() => radians(Number.NEGATIVE_INFINITY), RangeError)
})

test('normalizedGain and mouthOpenRatio enforce [0, 1] bounds', () => {
  assert.equal(normalizedGain(0), 0)
  assert.equal(normalizedGain(0.5), 0.5)
  assert.equal(normalizedGain(1), 1)
  assert.equal(isNormalizedGain(1.01), false)
  assert.throws(() => normalizedGain(-0.01), RangeError)
  assert.throws(() => normalizedGain(1.5), RangeError)
  assert.throws(() => normalizedGain(Number.NaN), RangeError)

  assert.equal(mouthOpenRatio(0.4), 0.4)
  assert.equal(isMouthOpenRatio(-0.1), false)
  assert.throws(() => mouthOpenRatio(1.2), RangeError)
})

test('clampMouthOpenRatio bounds out-of-range and non-finite inputs without throwing', () => {
  assert.equal(clampMouthOpenRatio(-0.5), 0)
  assert.equal(clampMouthOpenRatio(0.35), 0.35)
  assert.equal(clampMouthOpenRatio(2.5), 1)
  assert.equal(clampMouthOpenRatio(Number.NaN), 0)
  assert.equal(clampMouthOpenRatio(Number.POSITIVE_INFINITY), 0)
})

test('secondsToMilliseconds and secondsToCentiseconds round and clamp negative inputs to 0', () => {
  assert.equal(secondsToMilliseconds(0.5), 500)
  assert.equal(secondsToMilliseconds(0.1256), 126)
  assert.equal(secondsToMilliseconds(-2), 0)
  assert.equal(secondsToMilliseconds(Number.NaN), 0)

  assert.equal(secondsToCentiseconds(0.5), 50)
  assert.equal(secondsToCentiseconds(1.236), 124)
  assert.equal(secondsToCentiseconds(-1), 0)
})
