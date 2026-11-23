import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AudioArbiter, AudioArbiterState, type AudioRole, type PreemptionDecision } from './audio-arbiter.js'

const ALL_ROLES: readonly AudioRole[] = ['wake-listening', 'media-playback', 'short-utterance', 'realtime-conversation']

test('free arbiter grants acquisition to any role and tracks ownership', () => {
  for (const role of ALL_ROLES) {
    const arbiter = new AudioArbiter()
    assert.equal(arbiter.state, AudioArbiterState.Free)
    assert.equal(arbiter.currentRole, undefined)
    assert.equal(arbiter.resolveContention(role), 'allow')

    assert.equal(arbiter.tryAcquire(role), 'allow')
    assert.equal(arbiter.state, AudioArbiterState.Held)
    assert.equal(arbiter.currentRole, role)
  }
})

test('preemption policy enforces background vs foreground ownership rules without mutating holder', () => {
  const expected: Record<AudioRole, Record<AudioRole, PreemptionDecision>> = {
    'wake-listening': {
      'wake-listening': 'reject-busy',
      'media-playback': 'stop-and-wait',
      'short-utterance': 'stop-and-wait',
      'realtime-conversation': 'stop-and-wait',
    },
    'media-playback': {
      'wake-listening': 'reject-busy',
      'media-playback': 'reject-busy',
      'short-utterance': 'stop-and-wait',
      'realtime-conversation': 'stop-and-wait',
    },
    'short-utterance': {
      'wake-listening': 'reject-busy',
      'media-playback': 'reject-busy',
      'short-utterance': 'reject-busy',
      'realtime-conversation': 'reject-busy',
    },
    'realtime-conversation': {
      'wake-listening': 'reject-busy',
      'media-playback': 'reject-busy',
      'short-utterance': 'reject-busy',
      'realtime-conversation': 'reject-busy',
    },
  }

  for (const holder of ALL_ROLES) {
    const arbiter = new AudioArbiter()
    assert.equal(arbiter.tryAcquire(holder), 'allow')
    for (const incoming of ALL_ROLES) {
      assert.equal(arbiter.resolveContention(incoming), expected[holder][incoming])
      assert.equal(arbiter.tryAcquire(incoming), expected[holder][incoming])
      assert.equal(arbiter.state, AudioArbiterState.Held)
      assert.equal(arbiter.currentRole, holder)
    }
  }
})

test('two-phase release blocks contenders until teardown is confirmed and guards against non-owners', () => {
  const arbiter = new AudioArbiter()
  assert.equal(arbiter.tryAcquire('media-playback'), 'allow')

  assert.equal(arbiter.confirmRelease(), false)
  assert.equal(arbiter.state, AudioArbiterState.Held)

  assert.equal(arbiter.beginRelease('wake-listening'), false)
  assert.equal(arbiter.state, AudioArbiterState.Held)

  assert.equal(arbiter.resolveContention('realtime-conversation'), 'stop-and-wait')
  assert.equal(arbiter.beginRelease('media-playback'), true)
  assert.equal(arbiter.beginRelease('media-playback'), false)
  assert.equal(arbiter.state, AudioArbiterState.Releasing)
  assert.equal(arbiter.currentRole, 'media-playback')

  for (const role of ALL_ROLES) {
    assert.equal(arbiter.resolveContention(role), 'reject-busy')
    assert.equal(arbiter.tryAcquire(role), 'reject-busy')
  }

  assert.equal(arbiter.confirmRelease('realtime-conversation'), false)
  assert.equal(arbiter.state, AudioArbiterState.Releasing)

  assert.equal(arbiter.confirmRelease('media-playback'), true)
  assert.equal(arbiter.confirmRelease('media-playback'), false)
  assert.equal(arbiter.state, AudioArbiterState.Free)
  assert.equal(arbiter.currentRole, undefined)

  assert.equal(arbiter.tryAcquire('realtime-conversation'), 'allow')
  assert.equal(arbiter.state, AudioArbiterState.Held)
  assert.equal(arbiter.currentRole, 'realtime-conversation')
})

test('quarantine permanently rejects all acquisitions and cannot be cleared by release callbacks', () => {
  const arbiter = new AudioArbiter()
  assert.equal(arbiter.tryAcquire('realtime-conversation'), 'allow')
  assert.equal(arbiter.beginRelease(), true)

  arbiter.markQuarantined('native capture callback did not stop')
  arbiter.markQuarantined('subsequent warning')

  assert.equal(arbiter.state, AudioArbiterState.Quarantined)
  assert.equal(arbiter.currentRole, undefined)
  assert.equal(arbiter.quarantineReason, 'native capture callback did not stop')

  assert.equal(arbiter.beginRelease(), false)
  assert.equal(arbiter.confirmRelease(), false)
  assert.equal(arbiter.state, AudioArbiterState.Quarantined)

  for (const role of ALL_ROLES) {
    assert.equal(arbiter.resolveContention(role), 'reject-quarantined')
    assert.equal(arbiter.tryAcquire(role), 'reject-quarantined')
  }
})
