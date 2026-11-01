import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PREF_KEYS } from '../../preferences/consts.js'
import { isAllowedPreferenceWrite, parsePreferenceProperty } from '../preference-write-guard.js'

test('preference writes need both an open window and an exact allowed domain/key pair', () => {
  for (const [domain, key] of PREF_KEYS) {
    assert.equal(isAllowedPreferenceWrite(PREF_KEYS, true, domain, key), true)
    assert.equal(isAllowedPreferenceWrite(PREF_KEYS, false, domain, key), false)
  }
  for (const [domain, key] of [
    ['other', 'ssid'],
    ['wifi', 'other'],
    ['wifi', 'ssid.extra'],
    ['wifi.extra', 'ssid'],
  ]) {
    assert.equal(isAllowedPreferenceWrite(PREF_KEYS, true, domain, key), false)
  }
  assert.equal(isAllowedPreferenceWrite([], true, 'wifi', 'ssid'), false)
})

test('wire property names must contain exactly one separator and two nonempty segments', () => {
  assert.deepEqual(parsePreferenceProperty('wifi.ssid'), { domain: 'wifi', key: 'ssid' })
  for (const prop of ['', 'wifi', '.ssid', 'wifi.', 'wifi.ssid.extra', 'wifi..ssid', null, 1, {}, ['wifi.ssid']]) {
    assert.equal(parsePreferenceProperty(prop), undefined)
  }
})
