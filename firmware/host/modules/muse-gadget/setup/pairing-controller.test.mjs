import assert from 'node:assert/strict'
import test from 'node:test'
import { createPairingController, pairingDeviceName } from './pairing-controller.js'

function fixture(setupComplete = false) {
  const calls = [],
    states = []
  let options
  const native = {
    close() {
      calls.push('native.close')
    },
  }
  const peripheral = {
    advertise() {
      calls.push('advertise')
    },
    async confirmPhysical() {
      calls.push('confirm')
      return true
    },
    close() {
      calls.push('peripheral.close')
    },
  }
  const account = {
    close() {
      calls.push('account.close')
    },
  }
  const c = createPairingController({
    setupComplete,
    identity: { mac: '02:11:22:ab:cd:ef', nodeId: 'homelink-abcdef' },
    createNative() {
      calls.push('native')
      return native
    },
    createPeripheral(o) {
      options = o
      calls.push('peripheral')
      return peripheral
    },
    createAccount(n, g) {
      assert.equal(n, native)
      assert.equal(g, 7)
      calls.push('claim')
      return account
    },
    coordinator: {
      acceptProvision(a, g) {
        assert.equal(a, account)
        assert.equal(g, 7)
        calls.push('accept')
      },
      close() {
        calls.push('coordinator.close')
      },
    },
    onChange(s) {
      states.push(s)
    },
  })
  return {
    c,
    calls,
    states,
    get options() {
      return options
    },
  }
}
test('nothing starts at construction; explicit start advertises only after ready', async () => {
  const f = fixture()
  assert.deepEqual(f.calls, [])
  f.c.start()
  assert.deepEqual(f.calls, ['native', 'peripheral'])
  f.options.onReady()
  await Promise.resolve()
  assert.equal(f.calls.at(-1), 'advertise')
  assert.throws(() => f.c.start())
})
test('unknown or completed setup never constructs the radio', () => {
  for (const state of [true, null]) {
    const f = fixture(state)
    assert.throws(() => f.c.start())
    assert.deepEqual(f.calls, [])
  }
})
test('physical confirmation is not automatic and opaque claim does not save or connect', async () => {
  const f = fixture()
  f.c.start()
  f.options.onConfirmation()
  assert.ok(!f.calls.includes('confirm'))
  assert.equal(await f.c.confirmPhysical(), true)
  f.options.onProvision({ generation: 7, provisionReady: true })
  assert.deepEqual(f.calls.slice(-2), ['claim', 'accept'])
  f.options.onProvision({ generation: 7, provisionReady: true })
  assert.equal(f.calls.filter((x) => x === 'claim').length, 1)
  assert.equal(f.states.at(-1).claimed, true)
})
test('close fences ready and provision callbacks', async () => {
  const f = fixture()
  f.c.start()
  f.options.onReady()
  f.c.close()
  await Promise.resolve()
  f.options.onProvision({ generation: 7, provisionReady: true })
  assert.ok(!f.calls.includes('advertise'))
  assert.ok(!f.calls.includes('claim'))
  const n = f.calls.length
  f.c.close()
  assert.equal(f.calls.length, n)
})

test('official BLE name uses verified last-three MAC bytes and matches node identity', () => {
  assert.equal(pairingDeviceName({ mac: '02:11:22:aB:cd:ef' }), 'MuseGadget-ABCDEF')
  assert.equal(pairingDeviceName({ nodeId: 'homelink-123456' }), 'MuseGadget-123456')
  for (const identity of [
    {},
    { mac: 'bad' },
    { nodeId: 'stopwatch-abcdef' },
    { nodeId: 'homelink-ABCDEF' },
    { mac: '02:11:22:ab:cd:ef', nodeId: 'homelink-123456' },
  ])
    assert.throws(() => pairingDeviceName(identity), /pairing_identity_invalid/)
  const f = fixture()
  f.c.start()
  assert.equal(f.options.name, 'MuseGadget-ABCDEF')
  assert.equal(f.states[0].name, f.options.name)
})
