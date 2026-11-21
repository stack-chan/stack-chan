import assert from 'node:assert/strict'
import test from 'node:test'
import { createMuseVoiceBridge } from '../voice-bridge.js'

const encode = (value) => new TextEncoder().encode(value)
const decode = (value) => new TextDecoder().decode(value)
function fixture({ stallPlayback = false, stallFence = false } = {}) {
  let releaseFence
  const fenceWait = new Promise((resolve) => {
    releaseFence = resolve
  })
  const samples = [],
    actions = [],
    fences = []
  let releasePlayback
  const playbackWait = new Promise((resolve) => {
    releasePlayback = resolve
  })
  let callback,
    input,
    now = 0,
    state = 1
  const timers = new Map(),
    sent = [],
    events = [],
    played = []
  let serial = 0,
    coreClosed = false,
    nativeClosed = false
  const snapshot = (actions = 0, extra = {}) => ({ actions, state, held: false, activeTurns: [], ...extra })
  const core = {
    begin() {
      state = 1
    },
    admission: () => 'admission\n',
    endCallBody: () => 'end',
    head() {
      state = 2
      return snapshot()
    },
    event(value) {
      const event = JSON.parse(value)
      if (event.type === 'ready') {
        state = 3
        return snapshot(32)
      }
      if (event.type === 'audio')
        return snapshot(0, { kind: 2, gateVerdict: 2, pcm: new Uint8Array(64), audible: true })
      return snapshot(0, event)
    },
    action(method) {
      actions.push(method)
      if (method === 'hangUp') {
        state = 4
        return snapshot(3)
      }
      if (method === 'mediaEnd') {
        state = 0
        return snapshot(64, { reason: 1 })
      }
      if (method === 'lost') {
        state = 0
        return snapshot(64, { reason: 9 })
      }
      return snapshot()
    },
    uplink(data) {
      samples.push({ length: data.length, first: data[0] })
      return { consumed: Math.min(data.length, 1280), line: 'append\n' }
    },
    close() {
      coreClosed = true
    },
  }
  const native = {
    start() {
      sent.push(['start'])
    },
    handshake() {
      sent.push(['handshake'])
    },
    voiceRequest(stream, id, body) {
      sent.push(['voice', stream, id, decode(body)])
    },
    bodyChunk(stream, body, end) {
      sent.push(['body', stream, decode(body), end])
    },
    endCall(stream, body) {
      sent.push(['end', stream, decode(body)])
    },
    resetStream(stream) {
      sent.push(['reset', stream])
    },
    receive: (frame) => frame,
    close() {
      nativeClosed = true
    },
  }
  const media = {
    input: {},
    output: {
      begin: (name) => ({ name }),
      async fence(generation) {
        fences.push(generation)
        if (stallFence) await fenceWait
        releasePlayback()
        return []
      },
      async finish(outputId) {
        if (stallPlayback) await playbackWait
        return { outputId, state: 'played' }
      },
    },
    media: {
      async connect(source, sink) {
        if (!source.isOutput) input = sink.write
        return { done: Promise.resolve(), async close() {} }
      },
    },
  }
  const dependencies = {
    createCore: () => core,
    openNative: (_, cb) => {
      callback = cb
      return native
    },
    encode,
    decode,
    createPcmSink: (_, write) => ({ write }),
    createPcmSource: () => ({
      output: { isOutput: true },
      async push(data) {
        played.push(data)
      },
      end() {},
    }),
    nowUs: () => now,
    wallMs: () => 100000,
    callId: () => 'call-test',
    setTimer(cb, delay) {
      const id = ++serial
      timers.set(id, { cb, delay })
      return id
    },
    clearTimer: (id) => timers.delete(id),
  }
  const controller = new AbortController()
  const bridge = createMuseVoiceBridge({ nodeId: 'test' }, dependencies)
  const opening = bridge.open({ media, signal: controller.signal, onEvent: (event) => events.push(event) })
  const microtasks = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
  }
  return {
    sent,
    samples,
    actions,
    fences,
    releaseFence,
    events,
    played,
    opening,
    controller,
    microtasks,
    async ready() {
      await microtasks()
      callback(1)
      callback(2, new ArrayBuffer(0))
      callback(2, { stream: 1, kind: 2, status: 200, body: encode('{"type":"ready"}\n') })
      return opening
    },
    frame(frame) {
      callback(2, frame)
    },
    line(event) {
      callback(2, { stream: 1, kind: 3, body: encode(`${JSON.stringify(event)}\n`) })
    },
    capture(data) {
      input(data)
    },
    poll(at) {
      now = at
      const entry = [...timers].find(([, t]) => t.delay === 10)
      if (entry) {
        timers.delete(entry[0])
        entry[1].cb()
      }
    },
    timeout(delay) {
      const entry = [...timers].find(([, t]) => t.delay === delay)
      assert.ok(entry)
      timers.delete(entry[0])
      entry[1].cb()
    },
    closed() {
      return coreClosed && nativeClosed
    },
  }
}

test('voice admission bypasses link registration, waits for ready, and paces microphone', async () => {
  const f = fixture(),
    call = await f.ready()
  assert.deepEqual(
    f.sent.map((x) => x[0]),
    ['start', 'handshake', 'voice', 'body'],
  )
  f.capture(new Uint8Array(1280))
  f.poll(100000)
  assert.equal(f.sent.filter((x) => x[2] === 'append\n').length, 1)
  f.sent.length = 0
  await call.setInputEnabled(true)
  f.poll(400000)
  f.capture(new Uint8Array(2560))
  f.poll(400000)
  assert.equal(f.sent.filter((x) => x[2] === 'append\n').length, 1)
  f.poll(410000)
  assert.equal(f.sent.filter((x) => x[2] === 'append\n').length, 1)
  f.poll(440000)
  assert.equal(f.sent.filter((x) => x[2] === 'append\n').length, 2)
  const closing = call.close({ mode: 'abort' })
  f.frame({ stream: 3, kind: 2, status: 200, end: true })
  f.frame({ stream: 1, kind: 3, end: true })
  assert.equal((await closing).remoteFinalization, 'confirmed')
  assert.equal(f.closed(), true)
})

test('settlement is core-owned, audio and finalization receipts remain distinct', async () => {
  const f = fixture(),
    call = await f.ready()
  f.line({ type: 'turn', activeTurns: ['s1'] })
  f.line({ type: 'audio' })
  await f.microtasks()
  assert.equal(f.played.length, 1)
  assert.equal(
    f.events.some((e) => e.type === 'output.playback'),
    false,
  )
  f.line({ type: 'settle', activeTurns: [] })
  assert.deepEqual(
    f.events.filter((e) => e.type.startsWith('turn.')).map((e) => e.type),
    ['turn.started', 'turn.settled'],
  )
  const closing = call.close({ mode: 'drain' })
  f.frame({ stream: 3, kind: 2, status: 503, end: true })
  f.frame({ stream: 1, kind: 3, end: true })
  assert.equal((await closing).remoteFinalization, 'unknown')
  assert.equal(f.events.filter((e) => e.type === 'output.playback').length, 1)
})

test('abort before admission closes transport and core', async () => {
  const f = fixture()
  await f.microtasks()
  f.controller.abort()
  await assert.rejects(f.opening)
  assert.equal(f.closed(), true)
})

test('drain deadline fences playback without claiming remote finalization', async () => {
  const f = fixture({ stallPlayback: true }),
    call = await f.ready()
  f.line({ type: 'audio' })
  await f.microtasks()
  const closing = call.close({ mode: 'drain', timeoutMs: 50 })
  f.frame({ stream: 1, kind: 3, end: true })
  await f.microtasks()
  f.timeout(50)
  const result = await closing
  assert.equal(result.reason, 'drain-timeout')
  assert.equal(result.remoteFinalization, 'unknown')
  assert.equal(f.closed(), true)
})

test('UTF-8 NDJSON may span Noise frames and captions are not logged', async () => {
  const f = fixture(),
    call = await f.ready()
  const wire = encode(
    `${JSON.stringify({ type: 'transcription.completed', kind: 12, itemId: 'u', text: 'こんにちは' })}\n`,
  )
  for (let i = 0; i < wire.length; i += 3) f.frame({ stream: 1, kind: 3, body: wire.subarray(i, i + 3) })
  assert.deepEqual(f.events[0], {
    type: 'input.transcript',
    value: { utteranceId: 'u', text: 'こんにちは', final: true },
  })
  const closing = call.close({ mode: 'abort' })
  f.frame({ stream: 1, kind: 4 })
  await closing
})

test('protocol failure attempts end-call while the transport is connected', async () => {
  const f = fixture()
  const call = await f.ready()
  f.frame({ stream: 1, kind: 3, body: encode('{bad json\n') })
  assert.equal(
    f.sent.some((item) => item[0] === 'end'),
    true,
  )
  const closing = call.close({ mode: 'abort' })
  f.frame({ stream: 3, kind: 2, status: 200, end: true })
  f.frame({ stream: 1, kind: 3, end: true })
  assert.equal((await closing).remoteFinalization, 'confirmed')
  assert.equal(f.closed(), true)
})

test('release drains captured speech then sends paced silence, hold transitions discard stale input', async () => {
  const f = fixture(),
    call = await f.ready()
  await call.setInputEnabled(true)
  f.capture(new Uint8Array(1280).fill(7))
  await call.setInputEnabled(false)
  f.poll(100000)
  assert.equal(f.samples.at(-1).first, 7)
  f.poll(140000)
  assert.deepEqual(f.samples.at(-1), { length: 640, first: 0 })
  const count = f.samples.length
  f.poll(150000)
  assert.equal(f.samples.length, count)
  f.poll(160000)
  assert.equal(f.samples.length, count + 1)
  f.poll(2000000)
  assert.equal(f.samples.length, count + 2)
  await call.setInputEnabled(true)
  f.capture(new Uint8Array(1280).fill(9))
  f.line({ type: 'hold', actions: 128, held: true })
  f.line({ type: 'resume', actions: 128, held: false })
  const before = f.samples.length
  f.poll(2100000)
  assert.equal(f.samples.length, before)
  assert.equal(f.actions.filter((value) => value === 'discard').length, 2)
  const closing = call.close({ mode: 'abort' })
  f.frame({ stream: 1, kind: 3, end: true })
  await closing
})

test('a release wins over an in-flight press and fences keep distinct generations', async () => {
  const f = fixture({ stallFence: true }),
    call = await f.ready()
  const pressing = call.setInputEnabled(true)
  await call.setInputEnabled(false)
  const second = call.interrupt()
  await f.microtasks()
  assert.deepEqual(f.fences, [1])
  f.releaseFence()
  await Promise.all([pressing, second])
  assert.deepEqual(f.fences, [1, 2])
  f.capture(new Uint8Array(1280).fill(17))
  f.poll(100000)
  assert.equal(f.samples.at(-1).first, 0)
  const closing = call.close({ mode: 'abort' })
  f.frame({ stream: 1, kind: 3, end: true })
  await closing
})

test('remote stop publishes one terminal event only after native cleanup', async () => {
  const f = fixture(),
    call = await f.ready()
  const push = f.events.push.bind(f.events)
  f.events.push = (event) => {
    if (event.type === 'session.ended') assert.equal(f.closed(), true)
    return push(event)
  }
  f.line({ type: 'stop', actions: 3, state: 4, reason: 2 })
  f.frame({ stream: 3, kind: 2, status: 200, end: true })
  f.frame({ stream: 1, kind: 3, end: true })
  await f.microtasks()
  const terminal = f.events.filter((event) => event.type === 'session.ended')
  assert.equal(terminal.length, 1)
  assert.deepEqual(terminal[0].result, { reason: 'drained', remoteFinalization: 'confirmed' })
  assert.deepEqual(await call.close({ mode: 'abort' }), terminal[0].result)
  assert.equal(f.events.filter((event) => event.type === 'session.ended').length, 1)
})
