import assert from 'node:assert/strict'
import test from 'node:test'
import { createMuseConversation } from '../voice-conversation.js'

function fixture() {
  const controller = new AbortController()
  const events = []
  const controls = []
  let receive
  const call = {
    id: 'call-test',
    async setInputEnabled(value) {
      controls.push(['input', value])
    },
    async interrupt() {
      controls.push(['interrupt'])
      return []
    },
    async close(options) {
      controls.push(['close', options])
      return { reason: 'aborted', remoteFinalization: 'unknown' }
    },
  }
  const conversation = createMuseConversation({
    async open(options) {
      receive = options.onEvent
      return call
    },
  })
  return {
    controller,
    events,
    controls,
    conversation,
    emit(event) {
      receive(event)
    },
    open(history = []) {
      return conversation.open({
        media: {},
        signal: controller.signal,
        history,
        onEvent: (event) => events.push(event),
      })
    },
  }
}

test('provider settlement is distinct from playback receipts', async () => {
  const f = fixture()
  const session = await f.open()
  f.emit({ type: 'turn.started', turnId: 'a' })
  f.emit({ type: 'turn.settled', turnId: 'a' })
  assert.deepEqual(f.events[1], { type: 'turn.ended', turnId: 'a', status: 'completed' })
  assert.equal(
    f.events.some((event) => event.type === 'output.playback'),
    false,
  )
  const receipt = { outputId: 'a', generation: 0, state: 'played', position: { basis: 'unknown' } }
  f.emit({ type: 'output.playback', receipt })
  assert.deepEqual(f.events[2], { type: 'output.playback', receipt })
  await session.close({ mode: 'abort' })
})

test('unsupported inputs are rejected and interruption never promises remote cancel', async () => {
  const f = fixture()
  assert.equal(f.conversation.capabilities.textInput, false)
  await assert.rejects(f.open([{}]), { code: 'unsupported_capability' })
  const session = await f.open()
  await assert.rejects(session.submit({}), { code: 'unsupported_capability' })
  await session.setInputEnabled(true)
  assert.deepEqual(await session.interrupt(), { playback: [], remote: 'continued', history: 'restart-required' })
  const a = session.close({ mode: 'abort' })
  assert.equal(session.close({ mode: 'drain' }), a)
  assert.equal((await a).remoteFinalization, 'unknown')
  f.emit({ type: 'output.text', outputId: 'late', delta: 'ignored' })
  assert.equal(f.events.length, 0)
  await assert.rejects(session.setInputEnabled(true), { code: 'cancelled' })
  assert.equal(f.controls.filter((c) => c[0] === 'close').length, 1)
})

test('abort during connection releases the newly obtained call', async () => {
  const controller = new AbortController()
  let closeCount = 0
  const conversation = createMuseConversation({
    async open() {
      controller.abort()
      return {
        id: 'late',
        async close() {
          closeCount++
          return { reason: 'aborted', remoteFinalization: 'unknown' }
        },
      }
    },
  })
  await assert.rejects(conversation.open({ media: {}, signal: controller.signal, history: [], onEvent() {} }), {
    code: 'cancelled',
  })
  assert.equal(closeCount, 1)
})

test('fatal errors and captions are forwarded without changing finalization semantics', async () => {
  const f = fixture()
  const session = await f.open()
  const transcript = { type: 'input.transcript', value: { utteranceId: 'u', text: 'hello', final: true } }
  f.emit(transcript)
  f.emit({ type: 'error', code: 'provider_failed', fatal: true })
  assert.deepEqual(f.events, [transcript, { type: 'error', code: 'provider_failed', fatal: true }])
  await session.close({ mode: 'abort' })
})

test('session end survives explicit closing and forbids further input', async () => {
  const f = fixture()
  const session = await f.open()
  const closing = session.close({ mode: 'drain' })
  const result = { reason: 'drained', remoteFinalization: 'confirmed' }
  f.emit({ type: 'session.ended', result })
  await closing
  assert.deepEqual(f.events, [{ type: 'session.ended', result }])
  await assert.rejects(session.setInputEnabled(true), { code: 'cancelled' })
})
