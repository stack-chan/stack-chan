import assert from 'node:assert/strict'
import test from 'node:test'

import { LatestTrackingSender } from './latest-sender.mjs'
import { encodeTrackingPayload, TRACKING_MESSAGE_TYPE, TRACKING_SERVICE } from './tracking.mjs'

function trackingState({ yaw = 0.1, pitch = -0.2, emotion = 'neutral', left = null, right = null } = {}) {
  return {
    version: 4,
    face: { yaw, pitch, emotion, eyeOpen: { left: 1, right: 1 }, mouthOpen: 0 },
    hands: { left, right },
  }
}

test('sender broadcasts only the newest compact face state without waiting for a Local Peer ACK', async () => {
  const calls = []
  let release
  const session = {
    broadcast(type, payload) {
      calls.push({ type, payload })
      return new Promise((resolve) => {
        release = resolve
      })
    },
  }
  const sender = new LatestTrackingSender(session)
  sender.queue(trackingState({ yaw: 0.1 }))
  const first = sender.flush()
  sender.queue(trackingState({ yaw: 0.2 }))
  sender.queue(trackingState({ yaw: 0.3 }))
  assert.equal(await sender.flush(), false)
  release()
  assert.equal(await first, true)

  const second = sender.flush()
  assert.equal(calls[1].payload[2], 300)
  release()
  assert.equal(await second, true)
  assert.equal(calls[0].type, TRACKING_MESSAGE_TYPE)
  assert.equal(calls[0].payload[0], 4)
  assert.equal(calls[0].payload[1], 7, 'every update should include emotion, hands, and face parts')
  assert.equal(calls[1].payload[1], 7, 'auxiliary state should be resent after a dropped broadcast')
  assert.equal('send' in session, false, 'high-rate tracking should not use reliable point-to-point sends')
})

test('sender resends face, emotion, and hands at the 10 Hz transport cadence', async () => {
  const calls = []
  const session = {
    async broadcast(type, payload) {
      calls.push({ type, payload })
    },
  }
  const sender = new LatestTrackingSender(session)
  const left = { x: -0.5, y: 0.25, fingerCount: 2, variant: 7 }

  sender.queue(trackingState())
  await sender.flush()
  sender.queue(trackingState({ left }))
  await sender.flush()
  sender.queue(trackingState({ left }))
  await sender.flush()
  sender.queue(trackingState({ emotion: 'happy', left }))
  await sender.flush()

  assert.equal(calls[0].payload[1], 7)
  assert.equal(calls[1].payload[1], 7)
  assert.deepEqual(calls[1].payload.slice(4), [0, -32, 16, 2, 7, -129, 255, 255, 0])
  assert.equal(calls[2].payload[1], 7, 'unchanged hands should still be resent')
  assert.equal(calls[3].payload[1], 7, 'emotion and face parts should be included in every update')
  assert.equal(calls[3].payload[4], 1)
})

test('the worst-case compact tracking envelope fits one Local Peer frame', () => {
  const payload = encodeTrackingPayload(
    trackingState({
      yaw: 0.75,
      pitch: -Math.PI / 2,
      emotion: 'happy',
      left: { x: -2, y: 2, fingerCount: 3, variant: 7 },
      right: { x: 2, y: 2, fingerCount: 3, variant: 7 },
    }),
    { includeEmotion: true, includeHands: true }
  )
  const envelope = new TextEncoder().encode(
    JSON.stringify({ service: TRACKING_SERVICE, type: TRACKING_MESSAGE_TYPE, payload })
  )

  assert.ok(envelope.byteLength <= 216, `tracking envelope should fit one frame, got ${envelope.byteLength} bytes`)
})
