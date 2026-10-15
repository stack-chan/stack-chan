import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WiFiPowerPolicy, type WiFiPowerSaveMode } from '../wifi-power-policy.js'

function fixture() {
  const policy = new WiFiPowerPolicy()
  let mode: WiFiPowerSaveMode = 'none'
  const driver = {
    setMode(value: WiFiPowerSaveMode) {
      mode = value
    },
    getMode() {
      return mode
    },
  }
  policy.initialize(driver)
  return { policy, driver }
}

test('overlapping owners keep Wi-Fi awake until the last close', () => {
  const { policy } = fixture()
  assert.equal(policy.getMode(), 'min-modem')
  const first = policy.acquireLowLatency()
  const second = policy.acquireLowLatency()
  assert.equal(policy.getMode(), 'none')
  first.close()
  first.close()
  assert.equal(policy.getMode(), 'none')
  second.close()
  assert.equal(policy.getMode(), 'min-modem')
})

test('old completion cannot release a new session; reinitialization preserves ownership', () => {
  const { policy, driver } = fixture()
  const old = policy.acquireLowLatency()
  old.close()
  const current = policy.acquireLowLatency()
  policy.initialize(driver)
  old.close()
  assert.equal(policy.getMode(), 'none')
  current.close()
  assert.equal(policy.getMode(), 'min-modem')
})

test('requests before initialization are applied; unsupported targets remain usable', () => {
  const policy = new WiFiPowerPolicy()
  const lease = policy.acquireLowLatency()
  assert.equal(policy.getMode(), undefined)
  let mode: WiFiPowerSaveMode = 'min-modem'
  policy.initialize({
    setMode(value) {
      mode = value
    },
    getMode() {
      return mode
    },
  })
  assert.equal(mode, 'none')
  lease.close()
  assert.equal(mode, 'min-modem')
})

test('failed acquire restores the previous request without a leaked owner', () => {
  const { policy, driver } = fixture()
  const set = driver.setMode
  driver.setMode = (value) => {
    set(value)
    if (value === 'none') throw new Error('readback failed')
  }
  assert.throws(() => policy.acquireLowLatency(), /readback failed/)
  assert.equal(policy.getMode(), 'min-modem')
  driver.setMode = set
  const lease = policy.acquireLowLatency()
  lease.close()
  assert.equal(policy.getMode(), 'min-modem')
})

test('failed release retains no phantom owner; reapply retries the idle request', () => {
  const { policy, driver } = fixture()
  const lease = policy.acquireLowLatency()
  const set = driver.setMode
  driver.setMode = () => {
    throw new Error('driver unavailable')
  }
  assert.throws(() => lease.close(), /driver unavailable/)
  driver.setMode = set
  policy.reapply()
  assert.equal(policy.getMode(), 'min-modem')
  lease.close()
})

test('getter reports driver state rather than requested state', () => {
  const { policy, driver } = fixture()
  driver.setMode('none')
  assert.equal(policy.getMode(), 'none')
  policy.reapply()
  assert.equal(policy.getMode(), 'min-modem')
})

test('overlapping requests never reconfigure an already applied mode', () => {
  const { policy, driver } = fixture()
  const writes: string[] = []
  const set = driver.setMode
  driver.setMode = (value) => {
    writes.push(value)
    set(value)
  }
  const first = policy.acquireLowLatency()
  const second = policy.acquireLowLatency()
  policy.reapply()
  first.close()
  assert.deepEqual(writes, ['none'])
  second.close()
  assert.deepEqual(writes, ['none', 'min-modem'])
})
