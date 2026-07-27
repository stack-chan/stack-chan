import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { installUsbAudioTestAliases } from './__tests__/node-aliases.js'

installUsbAudioTestAliases()

const { usbEventTransportState } = await import('./event-transport.js')
const { StackChanCapability } = await import('./media-session.js')

const EVENT = StackChanCapability.EVENT

type NegotiationFixture = {
  capabilityBits: {
    event: number
  }
  eventNegotiation: Array<{
    dockAdvertisesEvent: boolean
    firmwareAdvertisesEvent: boolean
    expected: {
      conversationControlAvailable: boolean
    }
  }>
}

const fixture = JSON.parse(
  readFileSync('vendor/stack-chan-dock/contracts/usb-cdc-v2/negotiation-vectors.json', 'utf8'),
) as NegotiationFixture

test('EVENT transport is ready only when both peers advertise EVENT', () => {
  assert.equal(EVENT, fixture.capabilityBits.event)
  for (const vector of fixture.eventNegotiation) {
    assert.equal(
      usbEventTransportState(true, vector.firmwareAdvertisesEvent ? EVENT : 0, vector.dockAdvertisesEvent ? EVENT : 0),
      vector.expected.conversationControlAvailable ? 'ready' : 'unsupported',
      `firmware=${vector.firmwareAdvertisesEvent}, dock=${vector.dockAdvertisesEvent}`,
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
  for (const vector of fixture.eventNegotiation) {
    const local = vector.firmwareAdvertisesEvent
    const peer = vector.dockAdvertisesEvent
    const mutantReady = local || peer
    if (vector.expected.conversationControlAvailable !== mutantReady) counterexamples.push({ local, peer })
  }

  counterexamples.sort((left, right) => Number(left.local) - Number(right.local))
  assert.deepEqual(counterexamples, [
    { local: false, peer: true },
    { local: true, peer: false },
  ])
})
