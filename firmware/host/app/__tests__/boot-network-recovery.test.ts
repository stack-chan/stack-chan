import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
writeAliasPackage(hostRoot, 'localization', resolve(hostRoot, 'modules/testing/fakes/localization.js'))

const {
  bootWiFiFailureMessage,
  classifyBootWiFiFailure,
  networkReadyResultForRecoveryChoice,
  shouldRetryBootWiFiAttempt,
} = await import('../boot-network-recovery.js')

test('boot Wi-Fi retry helper respects the configured attempt limit', () => {
  assert.equal(shouldRetryBootWiFiAttempt(1, 3), true)
  assert.equal(shouldRetryBootWiFiAttempt(2, 3), true)
  assert.equal(shouldRetryBootWiFiAttempt(3, 3), false)
})

test('boot Wi-Fi helper detects scan exhaustion from network-service failures', () => {
  assert.equal(classifyBootWiFiFailure('Access point "home-ap" not found'), 'scan-exhausted')
  assert.equal(bootWiFiFailureMessage('Access point "home-ap" not found'), '保存済みWi-Fiが見つかりません')
})

test('boot Wi-Fi helper classifies non-scan failures as connection-failed', () => {
  assert.equal(classifyBootWiFiFailure('authentication failed'), 'connection-failed')
  assert.equal(bootWiFiFailureMessage('authentication failed'), 'Wi-Fi接続に失敗しました')
})

test('boot Wi-Fi helper distinguishes time-sync failures and includes the configured server', () => {
  assert.equal(classifyBootWiFiFailure('Failed to get time'), 'time-sync-failed')
  assert.equal(classifyBootWiFiFailure('FAILED TO GET TIME'), 'time-sync-failed')
  assert.equal(bootWiFiFailureMessage('Failed to get time'), 'Wi-Fi接続済み: 時刻同期に失敗しました')
  for (const host of ['pool.ntp.org', '192.0.2.123', 'not found.example']) {
    assert.equal(bootWiFiFailureMessage('Failed to get time', host), `Wi-Fi接続済み: 時刻同期に失敗しました\n${host}`)
  }
  assert.equal(classifyBootWiFiFailure('connection timeout'), 'connection-failed')
  assert.equal(bootWiFiFailureMessage('authentication failed', 'pool.ntp.org'), 'Wi-Fi接続に失敗しました')
})

test('boot Wi-Fi helper maps offline choice to a skipped network readiness result', () => {
  assert.deepEqual(networkReadyResultForRecoveryChoice('offline', 'authentication failed'), {
    status: 'skipped',
    reason: 'offline start selected: authentication failed',
  })
  assert.equal(networkReadyResultForRecoveryChoice('retry', 'authentication failed'), undefined)
})
