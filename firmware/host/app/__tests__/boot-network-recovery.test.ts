import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bootWiFiFailureMessage,
  classifyBootWiFiFailure,
  networkReadyResultForRecoveryChoice,
  shouldRetryBootWiFiAttempt,
} from '../boot-network-recovery.js'

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

test('boot Wi-Fi helper maps offline choice to a skipped network readiness result', () => {
  assert.deepEqual(networkReadyResultForRecoveryChoice('offline', 'authentication failed'), {
    status: 'skipped',
    reason: 'offline start selected: authentication failed',
  })
  assert.equal(networkReadyResultForRecoveryChoice('retry', 'authentication failed'), undefined)
})
