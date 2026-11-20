import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
writeAliasPackage(hostRoot, 'localization', resolve(hostRoot, 'modules/testing/fakes/localization.js'))

const {
  bootWiFiFailureDetails,
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
  assert.deepEqual(bootWiFiFailureDetails('Access point "home-ap" not found'), {
    message: '保存済みWi-Fiが見つかりません',
  })
})

test('boot Wi-Fi helper classifies non-scan failures as connection-failed', () => {
  assert.equal(classifyBootWiFiFailure('authentication failed'), 'connection-failed')
  assert.deepEqual(bootWiFiFailureDetails('authentication failed'), { message: 'Wi-Fi接続に失敗しました' })
})

test('boot Wi-Fi helper distinguishes time-sync failures and includes the configured server', () => {
  assert.equal(classifyBootWiFiFailure('Failed to get time'), 'time-sync-failed')
  assert.equal(classifyBootWiFiFailure('FAILED TO GET TIME'), 'time-sync-failed')
  const message = 'Wi-Fi接続済み: 時刻同期に失敗しました'
  assert.equal(bootWiFiFailureDetails('Failed to get time').message, message)
  assert.equal(bootWiFiFailureDetails('Failed to get time', '').sntpHost, undefined)
  for (const host of ['pool.ntp.org', '192.0.2.123', '[fe80::ABCD%eth0]', `${'W'.repeat(63)}.example`]) {
    assert.deepEqual(bootWiFiFailureDetails('Failed to get time', host), { message, sntpHost: host })
  }
  assert.equal(classifyBootWiFiFailure('connection timeout'), 'connection-failed')
  assert.deepEqual(bootWiFiFailureDetails('authentication failed', 'pool.ntp.org'), {
    message: 'Wi-Fi接続に失敗しました',
  })
})

test('boot Wi-Fi helper maps offline choice to a skipped network readiness result', () => {
  assert.deepEqual(networkReadyResultForRecoveryChoice('offline', 'authentication failed'), {
    status: 'skipped',
    reason: 'offline start selected: authentication failed',
  })
  assert.equal(networkReadyResultForRecoveryChoice('retry', 'authentication failed'), undefined)
})
