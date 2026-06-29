import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_FONT, DOMAIN, PREF_KEYS } from './consts.js'

test('preference domains and keys describe the app configuration surface', () => {
  assert.equal(DOMAIN.ui, 'ui')
  assert.equal(DOMAIN.driver, 'driver')
  assert.ok(PREF_KEYS.some(([domain, key, ctor]) => domain === DOMAIN.ui && key === 'type' && ctor === String))
  assert.ok(PREF_KEYS.some(([domain, key, ctor]) => domain === DOMAIN.driver && key === 'baudrate' && ctor === Number))
  assert.equal(DEFAULT_FONT, 'OpenSans-Regular-24.bf4')
})
