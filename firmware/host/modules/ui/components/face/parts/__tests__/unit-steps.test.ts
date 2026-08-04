import assert from 'node:assert/strict'
import { test } from 'node:test'

import { quantizeUnit, UNIT_OPEN_STEPS, unitFromStep } from '../unit-steps.js'

test('animation ratios quantize onto the bounded unit scale', () => {
  assert.equal(quantizeUnit(0), 0)
  assert.equal(quantizeUnit(1), UNIT_OPEN_STEPS)
  assert.equal(quantizeUnit(0.5), UNIT_OPEN_STEPS / 2)
  assert.equal(unitFromStep(quantizeUnit(0.5)), 0.5)
})

test('out-of-range and non-finite ratios clamp onto the unit scale', () => {
  assert.equal(quantizeUnit(Number.NaN), 0)
  assert.equal(quantizeUnit(-0.5), 0)
  assert.equal(quantizeUnit(2), UNIT_OPEN_STEPS)
  assert.equal(unitFromStep(-1), 0)
  assert.equal(unitFromStep(UNIT_OPEN_STEPS + 1), 1)
})
