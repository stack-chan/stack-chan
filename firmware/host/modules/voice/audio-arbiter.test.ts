import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AudioArbiter, AudioArbiterState, type AudioRole } from './audio-arbiter.js'

const ALL_ROLES: readonly AudioRole[] = ['short-utterance', 'realtime-conversation']

test('free arbiter begins acquisition into StoppingMedia and confirms into Held', () => {
  for (const role of ALL_ROLES) {
    const arbiter = new AudioArbiter()
    assert.equal(arbiter.state, AudioArbiterState.Free)
    assert.equal(arbiter.currentRole, undefined)

    assert.equal(arbiter.beginAcquire(role), true)
    assert.equal(arbiter.state, AudioArbiterState.StoppingMedia)
    assert.equal(arbiter.currentRole, role)

    assert.equal(arbiter.confirmAcquire(role), true)
    assert.equal(arbiter.state, AudioArbiterState.Held)
    assert.equal(arbiter.currentRole, role)
  }
})

test('arbiter blocks concurrent acquisition during StoppingMedia and Held and rejects non-owner release', () => {
  const arbiter = new AudioArbiter()
  assert.equal(arbiter.beginAcquire('realtime-conversation'), true)

  for (const incoming of ALL_ROLES) {
    assert.equal(arbiter.beginAcquire(incoming), false)
  }
  assert.equal(arbiter.confirmAcquire('short-utterance'), false)
  assert.equal(arbiter.release('short-utterance'), false)
  assert.equal(arbiter.state, AudioArbiterState.StoppingMedia)

  assert.equal(arbiter.confirmAcquire('realtime-conversation'), true)
  assert.equal(arbiter.confirmAcquire('realtime-conversation'), false)
  assert.equal(arbiter.state, AudioArbiterState.Held)

  for (const incoming of ALL_ROLES) {
    assert.equal(arbiter.beginAcquire(incoming), false)
  }
  assert.equal(arbiter.release('short-utterance'), false)
  assert.equal(arbiter.state, AudioArbiterState.Held)

  assert.equal(arbiter.release('realtime-conversation'), true)
  assert.equal(arbiter.release('realtime-conversation'), false)
  assert.equal(arbiter.state, AudioArbiterState.Free)
  assert.equal(arbiter.currentRole, undefined)
})

test('release during StoppingMedia rolls back failed media stop cleanly', () => {
  const arbiter = new AudioArbiter()
  assert.equal(arbiter.beginAcquire('short-utterance'), true)
  assert.equal(arbiter.state, AudioArbiterState.StoppingMedia)

  assert.equal(arbiter.release('short-utterance'), true)
  assert.equal(arbiter.state, AudioArbiterState.Free)
  assert.equal(arbiter.currentRole, undefined)

  assert.equal(arbiter.confirmAcquire('short-utterance'), false)
  assert.equal(arbiter.beginAcquire('realtime-conversation'), true)
  assert.equal(arbiter.confirmAcquire('realtime-conversation'), true)
  assert.equal(arbiter.state, AudioArbiterState.Held)
})
