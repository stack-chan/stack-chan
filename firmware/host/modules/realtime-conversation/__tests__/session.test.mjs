import assert from 'node:assert/strict'
import test from 'node:test'
import { liveConversation } from '../session.js'

function fixture(delegation) {
  const messages = [],
    events = [],
    operations = []
  let settings
  const receipt = { outputId: 'live-output', generation: 0, position: { basis: 'unknown' }, state: 'interrupted' }
  const output = {
    begin(id) {
      assert.equal(id, receipt.outputId)
    },
    async finish() {
      throw new Error('not draining')
    },
    async fence() {
      operations.push('fenced')
      return [receipt]
    },
  }
  const controller = new AbortController()
  const platform = {
    audio: {},
    borrowLiveAudio: () => 'borrowed',
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    createVoiceScope(parent) {
      const local = new AbortController()
      const abort = () => local.abort()
      parent?.addEventListener('abort', abort)
      return {
        signal: local.signal,
        abort,
        dispose() {
          parent?.removeEventListener('abort', abort)
        },
      }
    },
    createProtocol(value, lease) {
      settings = value
      assert.equal(lease, 'borrowed')
      return {
        async connect() {
          return { id: 'session-1' }
        },
        async close() {
          operations.push('closed peer')
          return { finalized: false }
        },
        appendDelegationResult(id, text) {
          messages.push({ id, text })
        },
      }
    },
  }
  const conversation = liveConversation({ delegation }, platform)
  return {
    messages,
    events,
    operations,
    receipt,
    open() {
      return conversation.open({
        media: { input: {}, output },
        signal: controller.signal,
        onEvent: (e) => events.push(e),
      })
    },
    receive: (event) => settings.onEvent(event),
    transcript: (value) => settings.onTranscript(value),
  }
}

test('continuous RTP fences playback before closing; a lost remote acknowledgment stays unknown', async () => {
  const f = fixture({ kind: 'none' }),
    session = await f.open()
  assert.deepEqual(await session.interrupt(), {
    playback: [f.receipt],
    remote: 'unknown',
    history: 'restart-required',
  })
  assert.deepEqual(f.operations, ['fenced', 'closed peer'])
  await session.close({ mode: 'abort' })
  assert.deepEqual(f.operations, ['fenced', 'closed peer'])
})

test('client delegation snapshots only past transcript and suppresses late results after interrupt', async () => {
  let resolve, request, signal
  const f = fixture({
    kind: 'client',
    delegate: {
      run(value, scope) {
        request = value
        signal = scope.signal
        return new Promise((done) => {
          resolve = done
        })
      },
    },
  })
  const session = await f.open()
  f.transcript({ role: 'user', delta: 'earlier', start_ms: 0, end_ms: 100 })
  f.transcript({ role: 'user', delta: 'later', start_ms: 200, end_ms: 300 })
  f.receive({ type: 'session.delegation.created', delegation: { target: 'client', id: 'd1' }, offset_ms: 150 })
  assert.deepEqual(
    request.input.map((item) => item.content[0].text),
    ['earlier'],
  )
  assert.equal(request.sessionId, 'session-1')
  await session.interrupt()
  assert.equal(signal.aborted, true)
  resolve([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'late' }] }])
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(f.messages, [])
})

test('client delegation publishes the final answer and releases its session ledger on close', async () => {
  const released = []
  const f = fixture({
    kind: 'client',
    delegate: {
      releaseSession(id) {
        released.push(id)
      },
      async run() {
        return [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [
              { type: 'output_text', text: 'answer' },
              { type: 'refusal', refusal: ' declined' },
            ],
          },
          {
            type: 'message',
            role: 'assistant',
            phase: 'commentary',
            content: [{ type: 'output_text', text: 'progress' }],
          },
        ]
      },
    },
  })
  const session = await f.open()
  f.receive({ type: 'session.delegation.created', delegation: { target: 'client', id: 'd1' }, offset_ms: 100 })
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(f.messages, [{ id: 'd1', text: 'answer declined' }])
  await session.close({ mode: 'abort' })
  assert.deepEqual(released, [session.id])
})
