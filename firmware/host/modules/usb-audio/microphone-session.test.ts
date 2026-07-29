import assert from 'node:assert/strict'
import test from 'node:test'
import { installUsbAudioTestAliases } from './__tests__/node-aliases.js'

installUsbAudioTestAliases()

const { MicrophoneSessionGuard, MicrophoneSessionResult } = await import('./microphone-session.js')

test('microphone stop is idempotent after its acknowledgement is lost', () => {
  const session = new MicrophoneSessionGuard()

  assert.equal(session.start(7, 16000, 0), MicrophoneSessionResult.ACCEPTED)
  assert.equal(session.start(7, 16000, 0), MicrophoneSessionResult.IDEMPOTENT)
  assert.equal(session.start(8, 16000, 0), MicrophoneSessionResult.BUSY)
  assert.equal(session.stop(7, 16000, 0), MicrophoneSessionResult.ACCEPTED)
  assert.equal(session.stop(7, 16000, 0), MicrophoneSessionResult.IDEMPOTENT)
})

test('a stale microphone stop cannot stop its replacement stream', () => {
  const session = new MicrophoneSessionGuard()
  assert.equal(session.start(1, 16000, 0), MicrophoneSessionResult.ACCEPTED)
  assert.equal(session.stop(1, 16000, 0), MicrophoneSessionResult.ACCEPTED)
  assert.equal(session.start(2, 16000, 0), MicrophoneSessionResult.ACCEPTED)

  assert.equal(session.stop(1, 16000, 0), MicrophoneSessionResult.STALE)
  assert.equal(session.streamId, 2)
  assert.equal(session.active, true)
})

test('forced microphone stop remains acknowledgeable until HELLO reset', () => {
  const session = new MicrophoneSessionGuard()
  session.start(4, 16000, 0)

  assert.equal(session.forceStop(), 4)
  assert.equal(session.stop(4, 16000, 0), MicrophoneSessionResult.IDEMPOTENT)

  session.reset()
  assert.equal(session.stop(4, 16000, 0), MicrophoneSessionResult.STALE)
})

test('invalid microphone controls do not mutate the active stream', () => {
  const session = new MicrophoneSessionGuard()
  const invalidStarts = [
    [0, 16000, 0],
    [0x10000, 16000, 0],
    [1.5, 16000, 0],
    [1, 24000, 0],
    [1, 16000, 1],
  ] as const
  for (const request of invalidStarts) {
    assert.equal(session.start(request[0], request[1], request[2]), MicrophoneSessionResult.INVALID)
  }
  assert.equal(session.active, false)

  assert.equal(session.start(9, 16000, 0), MicrophoneSessionResult.ACCEPTED)
  assert.equal(session.stop(9, 24000, 0), MicrophoneSessionResult.INVALID)
  assert.equal(session.stop(9, 16000, 1), MicrophoneSessionResult.INVALID)
  assert.equal(session.streamId, 9)
})

test('finite stream interleavings never let an old stop clear the current microphone', () => {
  const streamIds = [1, 2, 0xffff]
  let checked = 0
  for (const oldId of streamIds) {
    for (const currentId of streamIds) {
      if (oldId === currentId) continue
      const session = new MicrophoneSessionGuard()
      session.start(oldId, 16000, 0)
      session.stop(oldId, 16000, 0)
      session.start(currentId, 16000, 0)

      assert.equal(session.stop(oldId, 16000, 0), MicrophoneSessionResult.STALE)
      assert.equal(session.streamId, currentId)
      checked += 1
    }
  }

  assert.equal(checked, 6)
})
