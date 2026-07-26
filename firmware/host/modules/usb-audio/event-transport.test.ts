import assert from 'node:assert/strict'
import test from 'node:test'
import { installUsbAudioTestAliases } from './__tests__/node-aliases.js'

installUsbAudioTestAliases()

const { usbEventTransportState } = await import('./event-transport.js')
const { StackChanCapability } = await import('./media-session.js')

const EVENT = StackChanCapability.EVENT

test('EVENT transport is ready only when both peers advertise EVENT', () => {
  const cases = [
    { local: false, peer: false, expected: 'unsupported' },
    { local: false, peer: true, expected: 'unsupported' },
    { local: true, peer: false, expected: 'unsupported' },
    { local: true, peer: true, expected: 'ready' },
  ] as const

  for (const vector of cases) {
    assert.equal(
      usbEventTransportState(true, vector.local ? EVENT : 0, vector.peer ? EVENT : 0),
      vector.expected,
      `local=${vector.local}, peer=${vector.peer}`,
    )
  }
})

test('physical disconnection dominates every capability combination', () => {
  for (const local of [false, true]) {
    for (const peer of [false, true]) {
      assert.equal(usbEventTransportState(false, local ? EVENT : 0, peer ? EVENT : 0), 'disconnected')
    }
  }
})

test('the finite enumeration detects an OR-negotiation mutant', () => {
  const counterexamples: Array<{ local: boolean; peer: boolean }> = []
  for (const local of [false, true]) {
    for (const peer of [false, true]) {
      const expectedReady = local && peer
      const mutantReady = local || peer
      if (expectedReady !== mutantReady) counterexamples.push({ local, peer })
    }
  }

  assert.deepEqual(counterexamples, [
    { local: false, peer: true },
    { local: true, peer: false },
  ])
})
