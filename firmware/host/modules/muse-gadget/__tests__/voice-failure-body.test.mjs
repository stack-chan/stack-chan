import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyMuseFailureBody } from '../voice-bridge.js'

test('HTTP failure body is reduced to fixed categories, never server values', () => {
  assert.equal(classifyMuseFailureBody('Cannot POST /voice/realtime'), 'route')
  assert.equal(classifyMuseFailureBody('{"error":"device not found"}'), 'device')
  assert.equal(classifyMuseFailureBody('{"error":"unknown app"}'), 'app')
  assert.equal(classifyMuseFailureBody('{"detail":"Not Found"}'), 'not_found')
  assert.equal(classifyMuseFailureBody('secret-token-and-private-response'), 'other')
  assert.equal(classifyMuseFailureBody(''), 'empty')
})
