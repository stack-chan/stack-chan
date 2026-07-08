import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSettingsNetworkEntries } from './settings-network-list.js'

test('createSettingsNetworkEntries sorts networks by strongest signal', () => {
  assert.deepEqual(
    createSettingsNetworkEntries([
      { ssid: 'Workshop', rssi: -70 },
      { ssid: 'StackChan', rssi: -42 },
      { ssid: 'Guest', rssi: -56 },
    ]),
    [
      { ssid: 'StackChan', signal: -42, label: 'StackChan (-42 dBm)' },
      { ssid: 'Guest', signal: -56, label: 'Guest (-56 dBm)' },
      { ssid: 'Workshop', signal: -70, label: 'Workshop (-70 dBm)' },
    ],
  )
})

test('createSettingsNetworkEntries deduplicates SSIDs and keeps the strongest result', () => {
  assert.deepEqual(
    createSettingsNetworkEntries([
      { SSID: 'StackChan', RSSI: -80 },
      { ssid: 'StackChan', rssi: -45 },
      { ssid: 'StackChan', rssi: -60 },
    ]),
    [{ ssid: 'StackChan', signal: -45, label: 'StackChan (-45 dBm)' }],
  )
})

test('createSettingsNetworkEntries ignores empty SSIDs and sorts unknown signal by SSID', () => {
  assert.deepEqual(createSettingsNetworkEntries([{ ssid: '' }, { ssid: '  ' }, { ssid: 'Zoo' }, { ssid: 'Alpha' }]), [
    { ssid: 'Alpha', signal: undefined, label: 'Alpha' },
    { ssid: 'Zoo', signal: undefined, label: 'Zoo' },
  ])
})
