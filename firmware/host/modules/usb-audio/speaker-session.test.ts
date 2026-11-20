import assert from 'node:assert/strict'
import test from 'node:test'
import { installUsbAudioTestAliases } from './__tests__/node-aliases.js'

installUsbAudioTestAliases()

const { SpeakerSessionGuard, SpeakerSessionResult } = await import('./speaker-session.js')

test('a stale abort cannot stop the current speaker stream', () => {
  const session = new SpeakerSessionGuard()
  assert.equal(session.start(1, 24000, 0), SpeakerSessionResult.ACCEPTED)
  assert.equal(session.clear(1), true)
  assert.equal(session.start(2, 24000, 0), SpeakerSessionResult.ACCEPTED)

  assert.equal(session.abort(1, 24000, 0), SpeakerSessionResult.STALE)
  assert.equal(session.streamId, 2)
  assert.equal(session.sampleRate, 24000)
})

test('speaker controls validate stream, rate, payload, and ended state', () => {
  const session = new SpeakerSessionGuard()
  assert.equal(session.start(7, 24000, 1), SpeakerSessionResult.INVALID)
  assert.equal(session.start(7, 12345, 0), SpeakerSessionResult.INVALID)
  assert.equal(session.start(7, 24000, 0), SpeakerSessionResult.ACCEPTED)
  assert.equal(session.start(8, 24000, 0), SpeakerSessionResult.BUSY)
  assert.equal(session.streamId, 7)
  assert.equal(session.validateData(7, 24000, 0), SpeakerSessionResult.INVALID)
  assert.equal(session.end(7, 16000, 0), SpeakerSessionResult.INVALID)
  assert.equal(session.end(7, 24000, 1), SpeakerSessionResult.INVALID)
  assert.equal(session.end(7, 24000, 0), SpeakerSessionResult.ACCEPTED)
  assert.equal(session.validateData(7, 24000, 2), SpeakerSessionResult.INVALID)
  assert.equal(session.validateText(7, 24000, 2), SpeakerSessionResult.INVALID)
})

test('abort from a superseded stream is stale for every stream ID pair', () => {
  const streamIds = [1, 2, 0xffff]
  for (const oldId of streamIds) {
    for (const currentId of streamIds) {
      if (oldId === currentId) continue
      const correct = new SpeakerSessionGuard()
      correct.start(oldId, 24000, 0)
      correct.clear(oldId)
      correct.start(currentId, 24000, 0)
      assert.equal(correct.abort(oldId, 24000, 0), SpeakerSessionResult.STALE)
      assert.equal(correct.streamId, currentId)
    }
  }
})

test('completed speaker controls remain idempotent until the transport resets', () => {
  const session = new SpeakerSessionGuard()

  assert.equal(session.start(7, 24000, 0), SpeakerSessionResult.ACCEPTED)
  assert.equal(session.end(7, 24000, 0), SpeakerSessionResult.ACCEPTED)
  assert.equal(session.clear(7), true)
  assert.equal(session.end(7, 24000, 0), SpeakerSessionResult.IDEMPOTENT)
  assert.equal(session.abort(7, 24000, 0), SpeakerSessionResult.IDEMPOTENT)
  assert.equal(session.end(7, 16000, 0), SpeakerSessionResult.INVALID)
  assert.equal(session.end(8, 24000, 0), SpeakerSessionResult.STALE)

  session.reset()
  assert.equal(session.end(7, 24000, 0), SpeakerSessionResult.STALE)
})
