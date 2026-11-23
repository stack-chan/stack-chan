import assert from 'node:assert/strict'
import test from 'node:test'
import { createMuseChatAgent } from '../chat-agent.js'
import { MuseChatSession } from '../chat-session.js'
import { MuseChatTurn } from '../chat-turn.js'

const encode = (text) => new TextEncoder().encode(text).buffer
const decode = (body) => new TextDecoder().decode(body)
const event = (name, payload, seq) => ({ type: 'event', event: name, seq, payload: { session_id: 'chat', ...payload } })
const ack = (id = 'user') => ({ result: { session_id: 'chat', is_thread: true, message_id: id } })
const reply = (id = 'reply', parent = 'user') =>
  event('delta.message_done', { message_id: id, parent_message_id: parent, display_text: 'answer' })

test('acknowledgement binds early events to the dedicated side chat', () => {
  const turn = new MuseChatTurn('chat')
  turn.feed(reply(), 0)
  assert.equal(turn.complete(10000), false)
  turn.acknowledge(ack(), 1)
  assert.equal(turn.result().text, 'answer')
  assert.equal(turn.complete(3002), true)
  assert.throws(() => new MuseChatTurn('chat').acknowledge({ result: { message_id: 'u' } }, 0))
})

test('other chats, foreign parents and retired events cannot complete this turn', () => {
  const turn = new MuseChatTurn('chat', ['old'])
  turn.acknowledge(ack(), 0)
  turn.feed(event('delta.message_done', { session_id: 'other', message_id: 'x', display_text: 'wrong' }), 1)
  turn.feed(reply('old'), 1)
  turn.feed(reply('foreign', 'unrelated'), 1)
  turn.feed(event('delta.text_append', { message_id: 'foreign', text: 'wrong' }), 2)
  turn.feed(event('task.status', { task_id: 'old-task', status: 'completed' }), 3)
  assert.equal(turn.result().text, '')
  assert.equal(turn.complete(9000), false)
})

test('task activity holds complete messages until task completion', () => {
  const turn = new MuseChatTurn('chat')
  turn.acknowledge(ack(), 0)
  turn.feed(event('task.status', { task_id: 'task', status: 'running' }), 1)
  turn.feed(reply(), 2)
  assert.equal(turn.complete(9000), false)
  turn.feed(event('task.status', { task_id: 'task', status: 'completed' }), 9001)
  assert.equal(turn.complete(10002), true)
})

test('row and live sequence spaces remain independent, duplicate delta ignored', () => {
  const turn = new MuseChatTurn('chat')
  turn.acknowledge(ack(), 0)
  turn.feed(event('delta.text_append', { message_id: 'r', text: 'one' }, 10), 1)
  turn.feed(event('delta.text_append', { message_id: 'r', text: 'one' }, 10), 2)
  turn.feed(event('message.assistant', { message_id: 'r', display_text: 'final' }, 1), 3)
  assert.equal(turn.result().text, 'final')
  assert.equal(turn.complete(3004), true)
})

function fixture() {
  let now = 0,
    timerId = 0,
    emit
  const timers = new Map(),
    calls = []
  const socket = {
    start() {},
    handshake() {},
    close() {
      calls.push(['close'])
    },
    request(...args) {
      calls.push(['request', ...args])
    },
    chunk(data) {
      calls.push(['chunk', data])
    },
    resetStream(stream) {
      calls.push(['reset', stream])
    },
    bodyChunk(...args) {
      calls.push(['bodyChunk', ...args])
    },
    ttsRequest(...args) {
      calls.push(['tts', ...args])
    },
    receive() {
      return socket.frame
    },
  }
  const session = new MuseChatSession(
    { nodeId: 'node', sessionId: 'chat', turnTimeoutMs: 5000 },
    {
      open(_options, callback) {
        emit = callback
        return socket
      },
      encode,
      decode,
      now: () => now,
      setTimer(callback, delay) {
        const id = ++timerId
        timers.set(id, { callback, at: now + delay })
        return id
      },
      clearTimer(id) {
        timers.delete(id)
      },
    },
  )
  const feed = (stream, data = '', extra = {}) => {
    socket.frame = { stream, kind: 3, body: typeof data === 'string' ? encode(data) : data, ...extra }
    emit(2, encode('frame'))
  }
  const ready = async () => {
    const task = session.connect()
    emit(1)
    emit(2, encode('noise'))
    await task
  }
  const advance = (milliseconds) => {
    now += milliseconds
    for (const [id, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(id)
        timer.callback()
      }
  }
  return { session, ready, feed, calls, advance, timers }
}

test('new side chat 404 subscribes again after acknowledged send, no commands exposed', async () => {
  const f = fixture()
  await f.ready()
  assert.equal(f.calls.length, 0)
  const pending = f.session.send({ message: 'hello' })
  f.feed(3, '', { kind: 2, status: 404, end: true })
  const request = f.calls.at(-1)
  assert.deepEqual(request.slice(0, 3), ['request', 5, 1])
  assert.equal(JSON.parse(decode(request[3])).session_id, 'chat')
  f.feed(5, JSON.stringify(ack()), { kind: 2, status: 200, end: true })
  assert.deepEqual(f.calls.at(-1).slice(0, 3), ['request', 7, 2])
  f.feed(7, JSON.stringify(reply()) + '\n', { kind: 2, status: 200 })
  f.advance(3001)
  assert.equal((await pending).text, 'answer')
  f.session.close()
  assert.equal(f.timers.size, 0)
})

test('existing side chat waits for HTTP subscription readiness then binds early events', async () => {
  const f = fixture()
  await f.ready()
  const pending = f.session.send({ message: 'hello' })
  assert.deepEqual(f.calls.at(-1).slice(0, 3), ['request', 3, 2])
  f.feed(3, '', { kind: 2, status: 200 })
  f.feed(3, JSON.stringify(reply()) + '\n')
  f.feed(5, JSON.stringify(ack()), { end: true })
  f.advance(3001)
  assert.equal((await pending).messages[0].id, 'reply')
  f.session.close()
})

test('abort fences callbacks, closes native and prevents ambiguous same-chat reuse', async () => {
  const f = fixture()
  await f.ready()
  const controller = new AbortController()
  const task = f.session.send({ message: 'hello' }, { signal: controller.signal })
  f.feed(3, '', { kind: 2, status: 200 })
  controller.abort()
  await assert.rejects(task, { code: 'cancelled_unconfirmed' })
  await assert.rejects(f.session.connect(), { code: 'cancelled_unconfirmed' })
  assert.equal(f.timers.size, 0)
  f.feed(5, JSON.stringify(ack()), { end: true })
})

test('bounded wait does not report incomplete work as complete', async () => {
  const f = fixture()
  await f.ready()
  const task = f.session.send({ message: 'hello' })
  f.feed(3, '', { kind: 2, status: 200 })
  f.feed(5, JSON.stringify(ack()), { end: true })
  f.advance(5001)
  await assert.rejects(task, { code: 'deadline_exceeded' })
  assert.equal(f.timers.size, 0)
})

test('agent sends only latest user message, preserving Muse server-side history', async () => {
  const calls = []
  const agent = createMuseChatAgent({
    async send(value) {
      calls.push(value)
      return { status: 'completed', messages: [{ id: 'reply', text: 'answer' }] }
    },
  })
  const result = await agent.run(
    {
      turnId: 'turn',
      input: [
        { type: 'message', role: 'assistant', content: [] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ],
    },
    { signal: new AbortController().signal },
  )
  assert.deepEqual(calls, [{ message: 'hello' }])
  assert.equal(result.response.output[0].content[0].text, 'answer')
  await assert.rejects(
    agent.run({ input: [{ type: 'message', role: 'user', content: [{ type: 'input_image' }] }] }, {}),
    { code: 'unsupported_capability' },
  )
})

test('chunked request yields between bounded chunks and ends explicitly', async () => {
  const f = fixture()
  await f.ready()
  const controller = new AbortController()
  const body = {
    byteLength: 6,
    *[Symbol.iterator]() {
      yield 'abc'
      yield 'def'
    },
  }
  const pending = f.session.sendBody(body, { signal: controller.signal })
  f.feed(3, '', { kind: 2, status: 200 })
  assert.deepEqual(f.calls.at(-1).slice(0, 3), ['request', 5, 3])
  f.advance(0)
  assert.equal(decode(f.calls.at(-1)[2]), 'abc')
  f.advance(0)
  assert.equal(decode(f.calls.at(-1)[2]), 'def')
  f.advance(0)
  assert.deepEqual(f.calls.at(-1).slice(1), [5, new ArrayBuffer(0), true])
  controller.abort()
  await assert.rejects(pending)
})

test('TTS accepts bounded binary and falls back only on HTTP404', async () => {
  const f = fixture()
  await f.ready()
  const pending = f.session.readTts('reply', { maxBytes: 10 })
  assert.deepEqual(f.calls.at(-1), ['tts', 3, 'reply', false])
  await assert.rejects(f.session.send({ message: 'concurrent' }), { code: 'device_busy' })
  f.feed(3, '', { kind: 2, status: 404, end: true })
  assert.deepEqual(f.calls.at(-1), ['tts', 5, 'reply', true])
  f.feed(5, new Uint8Array([0xff, 0xfb, 1]).buffer, { kind: 2, status: 200, end: true })
  assert.deepEqual(await pending, new Uint8Array([0xff, 0xfb, 1]))
  assert.equal(f.timers.size, 0)
  f.session.close()
})

test('TTS oversized response and HTTP403 close without legacy retry', async () => {
  for (const status of [200, 403]) {
    const f = fixture()
    await f.ready()
    const pending = f.session.readTts('reply', { maxBytes: 1 })
    f.feed(3, new Uint8Array([1, 2]).buffer, { kind: 2, status, end: true })
    await assert.rejects(pending)
    assert.equal(f.calls.filter((call) => call[0] === 'tts').length, 1)
    assert.equal(f.timers.size, 0)
  }
})

test('TTS abort removes listeners and closes the transport', async () => {
  const f = fixture()
  await f.ready()
  const controller = new AbortController()
  const pending = f.session.readTts('reply', { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { code: 'cancelled' })
  f.feed(3, encode('late'), { kind: 2, status: 200, end: true })
  assert.equal(f.timers.size, 0)
})

test('subscription accepts SDK-sized metadata events across frames and bounds the line buffer', async () => {
  const f = fixture()
  await f.ready()
  const pending = f.session.send({ message: 'hello' })
  f.feed(3, '', { kind: 2, status: 200 })
  f.feed(5, JSON.stringify(ack()), { end: true })
  const line = JSON.stringify(event('metadata', { padding: 'x'.repeat(40000) })) + '\n'
  f.feed(3, line.slice(0, 20000))
  f.feed(3, line.slice(20000))
  f.feed(3, JSON.stringify(reply()) + '\n')
  f.advance(4000)
  assert.equal((await pending).status, 'completed')
  f.session.close()
  const g = fixture()
  await g.ready()
  const oversized = g.session.send({ message: 'hello' })
  g.feed(3, '', { kind: 2, status: 200 })
  g.feed(5, JSON.stringify(ack()), { end: true })
  g.feed(3, 'x'.repeat(262145))
  await assert.rejects(oversized, { code: 'resource_exhausted' })
})

test('retired replay and unrelated metadata are discarded before acknowledgment buffering', () => {
  const turn = new MuseChatTurn('chat', ['old'])
  turn.feed(event('message.assistant', { message_id: 'old', display_text: 'x'.repeat(40000) }), 0)
  turn.feed(event('metadata', { padding: 'x'.repeat(40000) }), 0)
  turn.acknowledge(ack(), 1)
  turn.feed(reply(), 2)
  assert.equal(turn.result().text, 'answer')
})

test('native open failures expose only a finite code, never the exception detail', async () => {
  for (const [message, code] of [
    ['Muse account WebSocket initialization', 4],
    ['private diagnostic detail', 0],
  ]) {
    const f = fixture()
    const received = []
    f.session.dependencies.onDiagnostic = (value) => received.push(value)
    f.session.dependencies.open = () => {
      throw new Error(message)
    }
    await assert.rejects(f.session.connect(), { code: 'provider_failed' })
    assert.deepEqual(received, [`note_connect_open_${code}`])
  }
})

test('reply settlement markers distinguish accepted reply from completed turn', async () => {
  const f = fixture(),
    diagnostics = []
  f.session.dependencies.onDiagnostic = (value) => diagnostics.push(value)
  await f.ready()
  const pending = f.session.send({ message: 'private user text' })
  f.feed(3, '', { kind: 2, status: 404, end: true })
  f.feed(5, JSON.stringify(ack()), { kind: 2, status: 200, end: true })
  f.feed(7, JSON.stringify(reply()) + '\n', { kind: 2, status: 200 })
  assert.ok(diagnostics.includes('note_subscription_body'))
  assert.ok(diagnostics.includes('note_reply_event'))
  assert.ok(!diagnostics.includes('note_reply_complete'))
  f.advance(3001)
  assert.equal((await pending).text, 'answer')
  assert.equal(diagnostics.filter((x) => x === 'note_reply_complete').length, 1)
  assert.ok(!diagnostics.some((x) => x.includes('private') || x.includes('answer')))
})
test('subscription close during settle fails before TTS even with a complete reply event', async () => {
  const f = fixture(),
    diagnostics = []
  f.session.dependencies.onDiagnostic = (value) => diagnostics.push(value)
  await f.ready()
  const pending = f.session.send({ message: 'hello' })
  f.feed(3, '', { kind: 2, status: 200 })
  f.feed(5, JSON.stringify(ack()), { kind: 2, status: 200, end: true })
  f.feed(3, JSON.stringify(reply()) + '\n', { end: true })
  await assert.rejects(pending, { code: 'provider_failed' })
  assert.ok(diagnostics.includes('note_reply_event'))
  assert.ok(diagnostics.includes('note_subscription_end'))
  assert.ok(!diagnostics.includes('note_reply_complete'))
})
