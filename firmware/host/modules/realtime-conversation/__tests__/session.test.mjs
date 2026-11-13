import assert from 'node:assert/strict'
import test from 'node:test'
import { liveConversation } from '../session.js'

function fixture(delegation, clock = { setTimer: setTimeout, clearTimer: clearTimeout }) {
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
    ...clock,
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

const delegationEvent = (id) => ({
  type: 'session.delegation.created',
  delegation: { target: 'client', id },
  offset_ms: 0,
})
const answer = (text = 'answer') => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }]
const settle = () => new Promise(setImmediate)

test('Live accepts more than 256 delegations and never evicts an in-flight duplicate', async () => {
  let releaseFirst
  const calls = []
  const f = fixture({
    kind: 'client',
    delegate: {
      run({ delegationId }) {
        calls.push(delegationId)
        return delegationId === 'first'
          ? new Promise((resolve) => {
              releaseFirst = resolve
            })
          : Promise.resolve(answer())
      },
    },
  })
  const session = await f.open()
  f.receive(delegationEvent('first'))
  for (let i = 0; i < 300; i++) {
    f.receive(delegationEvent(`d${i}`))
    await settle()
  }
  f.receive(delegationEvent('first'))
  f.receive(delegationEvent('d299'))
  await settle()
  assert.equal(calls.length, 301)
  assert.equal(f.messages.length, 300)
  releaseFirst(answer('first done'))
  await settle()
  assert.deepEqual(f.messages.at(-1), { id: 'first', text: 'first done' })
  assert.deepEqual(f.events, [])
  await session.close({ mode: 'abort' })
})

test('a fifth concurrent delegation receives a failure result without starting more work', async () => {
  const releases = []
  let calls = 0
  const f = fixture({
    kind: 'client',
    delegate: {
      run() {
        calls++
        return new Promise((resolve) => releases.push(resolve))
      },
    },
  })
  const session = await f.open()
  for (let i = 0; i < 5; i++) f.receive(delegationEvent(`d${i}`))
  f.receive(delegationEvent('d4'))
  await settle()
  assert.equal(calls, 4)
  assert.deepEqual(f.messages, [{ id: 'd4', text: '{"status":"failed","error":"device_busy"}' }])
  for (const release of releases) release(answer())
  await settle()
  f.receive(delegationEvent('next'))
  assert.equal(calls, 5)
  releases.at(-1)(answer())
  await settle()
  assert.equal(f.messages.at(-1).id, 'next')
  await session.close({ mode: 'abort' })
})

test('failed, empty, oversized and refused delegations all send a bounded provider result', async () => {
  const f = fixture({
    kind: 'client',
    delegate: {
      run({ delegationId }) {
        if (delegationId === 'throws') throw new Error('private synchronous error')
        if (delegationId === 'rejects') return Promise.reject(new Error('private asynchronous error'))
        if (delegationId === 'empty') return Promise.resolve([])
        if (delegationId === 'large') return Promise.resolve(answer('x'.repeat(4097)))
        return Promise.resolve([
          { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'I cannot do that.' }] },
        ])
      },
    },
  })
  const session = await f.open()
  for (const id of ['throws', 'rejects', 'empty', 'large', 'refuses']) {
    f.receive(delegationEvent(id))
    await settle()
  }
  assert.deepEqual(f.messages, [
    ...['throws', 'rejects', 'empty', 'large'].map((id) => ({
      id,
      text: '{"status":"failed","error":"provider_failed"}',
    })),
    { id: 'refuses', text: 'I cannot do that.' },
  ])
  assert.equal(f.events.length, 4)
  await session.close({ mode: 'abort' })
})

test('delegation timeout replies once and retains slots until uncooperative work settles', async () => {
  const timers = new Set()
  const clock = {
    setTimer(callback) {
      timers.add(callback)
      return callback
    },
    clearTimer(callback) {
      timers.delete(callback)
    },
  }
  const jobs = []
  const f = fixture(
    {
      kind: 'client',
      delegate: {
        run({ delegationId }, { signal }) {
          if (delegationId === 'after') return Promise.resolve(answer('recovered'))
          return new Promise((resolve) => jobs.push({ signal, resolve }))
        },
      },
    },
    clock,
  )
  const session = await f.open()
  for (let i = 0; i < 4; i++) f.receive(delegationEvent(`d${i}`))
  for (const expire of [...timers]) expire()
  await settle()
  assert.ok(jobs.every(({ signal }) => signal.aborted))
  assert.equal(timers.size, 0)
  assert.deepEqual(
    f.messages,
    Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, text: '{"status":"failed","error":"deadline_exceeded"}' })),
  )
  f.receive(delegationEvent('overflow'))
  f.receive(delegationEvent('d0'))
  await settle()
  assert.equal(jobs.length, 4)
  assert.deepEqual(f.messages.at(-1), { id: 'overflow', text: '{"status":"failed","error":"device_busy"}' })
  for (const { resolve } of jobs) resolve(answer('late'))
  await settle()
  assert.equal(f.messages.length, 5)
  f.receive(delegationEvent('after'))
  await settle()
  assert.deepEqual(f.messages.at(-1), { id: 'after', text: 'recovered' })
  await session.close({ mode: 'abort' })
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

test('client delegation publishes the final answer', async () => {
  const f = fixture({
    kind: 'client',
    delegate: {
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
})

test('Live transcript deltas preserve one stream without inventing final utterances', async () => {
  const f = fixture({ kind: 'none' })
  const session = await f.open()
  f.transcript({ role: 'user', delta: 'hello ', start_ms: 0, end_ms: 100 })
  f.transcript({ role: 'user', delta: 'world', start_ms: 100, end_ms: 200 })
  assert.deepEqual(f.events, [
    { type: 'input.transcript.delta', streamId: 'session-1/input', delta: 'hello ' },
    { type: 'input.transcript.delta', streamId: 'session-1/input', delta: 'world' },
  ])
  await assert.rejects(session.submit({}), { code: 'unsupported_capability' })
  await session.close({ mode: 'abort' })
})
