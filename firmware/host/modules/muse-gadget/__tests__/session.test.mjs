import assert from 'node:assert/strict'
import test from 'node:test'
import { createMuseDockRuntime } from '../runtime.js'
import { MuseSession } from '../session.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const encode = (text) => encoder.encode(text).buffer
function framed(message) {
  const body = new Uint8Array(encode(JSON.stringify(message)))
  const result = new Uint8Array(body.length + 4)
  new DataView(result.buffer).setUint32(0, body.length, true)
  result.set(body, 4)
  return result.buffer
}
function fixture(callbacks = {}) {
  const sockets = [],
    timers = new Map(),
    states = [],
    texts = []
  let id = 0,
    smiles = 0
  const session = new MuseSession(
    { host: 'example.invalid', vmId: 'test', token: 'fixture-only', nodeId: 'node-test' },
    {
      open(_options, emit) {
        const socket = {
          emit,
          calls: [],
          closeCount: 0,
          frame: undefined,
          close() {
            this.closeCount++
            this.emit(3)
          },
          start() {
            this.calls.push(['start'])
          },
          handshake(data) {
            this.calls.push(['handshake', data.slice(0)])
          },
          request(...args) {
            this.calls.push(['request', ...args])
          },
          chunk(body) {
            this.calls.push(['chunk', body.slice(0)])
          },
          receive() {
            return this.frame
          },
        }
        sockets.push(socket)
        return socket
      },
      setTimer(fn) {
        const handle = ++id
        timers.set(handle, () => {
          timers.delete(handle)
          fn()
        })
        return handle
      },
      clearTimer(handle) {
        timers.delete(handle)
      },
      encode,
      decode: (value) => decoder.decode(value),
      onState(state) {
        states.push(state)
        callbacks.onState?.(state, session)
      },
      onText(text) {
        texts.push(text)
        callbacks.onText?.(text, session)
      },
      onSmile() {
        smiles++
      },
    },
  )
  const feed = (stream, body, extra = {}) => {
    const socket = sockets.at(-1)
    socket.frame = { stream, body, kind: 3, end: false, ...extra }
    socket.emit(2, new ArrayBuffer(0))
  }
  const ready = () => {
    session.connect()
    sockets.at(-1).emit(1)
    sockets.at(-1).emit(2, encode('handshake fixture'))
    feed(1, framed({ type: 'res', id: 'stackchan-register', result: { status: 'registered' } }))
    feed(3, encode('{"type":"res","result":{}}\n'))
    assert.equal(session.state, 'ready')
  }
  return {
    session,
    sockets,
    timers,
    states,
    texts,
    ready,
    feed,
    get smiles() {
      return smiles
    },
  }
}

test('registration and subscription acknowledgements gate readiness and text', () => {
  const f = fixture()
  f.session.connect()
  assert.throws(() => f.session.sendText('hello'))
  f.sockets[0].emit(1)
  assert.equal(f.session.state, 'noise-handshake')
  f.sockets[0].emit(2, encode('fixture'))
  assert.equal(f.session.state, 'registering')
  f.feed(1, framed({ type: 'res', id: 'stackchan-register', result: { status: 'registered' } }))
  assert.equal(f.session.state, 'subscribing')
  assert.throws(() => f.session.sendText('hello'))
  f.feed(3, encode('{"type":"res","result":{}}\n'))
  f.session.sendText('こんにちは')
  const request = f.sockets[0].calls.at(-1)
  assert.deepEqual(request.slice(0, 3), ['request', 5, 1])
  assert.deepEqual(JSON.parse(decoder.decode(request[3])), { message: 'こんにちは', output_modality: 'text' })
  assert.throws(() => f.session.sendText('concurrent'))
})

test('late socket callbacks and timers are ignored after close and reconnect', () => {
  const f = fixture()
  f.ready()
  const socket = f.sockets[0],
    staleTimers = [...f.timers.values()]
  f.session.close()
  f.session.close()
  const states = f.states.length
  socket.emit(1)
  socket.emit(2, encode('stale'))
  staleTimers.forEach((fn) => {
    fn()
  })
  assert.equal(f.states.length, states)
  assert.equal(f.timers.size, 0)
  assert.equal(socket.closeCount, 1)
  f.ready()
  socket.emit(3)
  assert.equal(f.session.state, 'ready')
  assert.equal(f.sockets[1].calls[0][0], 'start')
})

test('fragmented UTF-8/control bytes are copied before input buffer reuse', () => {
  const f = fixture()
  f.ready()
  const control = new Uint8Array(framed({ method: 'link.invoke', id: 'smile', command: 'stackchan.smile', params: {} }))
  for (const byte of control) {
    const input = new Uint8Array([byte])
    f.feed(1, input.buffer)
    input[0] = 0
  }
  assert.equal(f.smiles, 1)
  const bytes = new Uint8Array(
    encode('{"type":"event","seq":1,"event":"delta.text_append","payload":{"text":"笑顔"}}\n'),
  )
  for (const byte of bytes) {
    const input = new Uint8Array([byte])
    f.feed(3, input.buffer)
    input[0] = 0
  }
  assert.deepEqual(f.texts, ['笑顔'])
})

test('only parameter-free smile is allowed; duplicates and unknown commands do not execute', () => {
  const f = fixture()
  f.ready()
  for (const message of [
    { id: 'one', command: 'stackchan.smile', params: {} },
    { id: 'one', command: 'stackchan.smile', params: {} },
    { id: 'two', command: 'stackchan.smile', params: { emotion: 'ANGRY' } },
    { id: 'three', command: 'device.ota' },
    { id: 'four', command: 'shell' },
  ])
    f.feed(1, framed({ method: 'link.invoke', ...message }))
  assert.equal(f.smiles, 1)
  const results = f.sockets[0].calls
    .filter((call) => call[0] === 'chunk')
    .slice(-4)
    .map((call) => JSON.parse(decoder.decode(call[1].slice(4))))
  assert.deepEqual(
    results.map((result) => result.ok),
    [true, false, false, false],
  )
})

test('timeouts, revocation, rejected status, oversized input and failed sends close resources', () => {
  for (const fault of ['timeout', 'revoked', 'status', 'oversized', 'send']) {
    const f = fixture()
    f.ready()
    if (fault === 'timeout') [...f.timers.values()][0]() // heartbeat itself is valid
    if (fault === 'timeout') {
      f.session.connect()
      ;[...f.timers.values()][0]()
    }
    if (fault === 'revoked') f.feed(1, framed({ type: 'event', event: 'link.unpaired' }))
    if (fault === 'status') f.feed(3, new ArrayBuffer(0), { kind: 2, status: 403 })
    if (fault === 'oversized') f.feed(3, encode('x'.repeat(8193)))
    if (fault === 'send') {
      f.sockets[0].request = () => {
        throw new Error('private detail')
      }
      f.session.sendText('hello')
    }
    assert.equal(f.session.state, 'failed', fault)
    assert.equal(f.timers.size, 0, fault)
    assert.equal(f.sockets.at(-1).closeCount, 1, fault)
    assert.ok(!JSON.stringify(f.states).includes('private detail'))
  }
})

test('closing inside callbacks suppresses subsequent frames and heartbeat', () => {
  const f = fixture({
    onState(state, session) {
      if (state === 'ready') session.close()
    },
  })
  f.session.connect()
  f.sockets[0].emit(1)
  f.sockets[0].emit(2, encode('fixture'))
  f.feed(1, framed({ type: 'res', id: 'stackchan-register', result: { status: 'registered' } }))
  f.feed(3, encode('{"type":"res","result":{}}\n'))
  assert.equal(f.session.state, 'stopped')
  assert.equal(f.timers.size, 0)
})

test('dock lifecycle closes on MOD/context replacement and guards captured callbacks', () => {
  const sessions = [],
    effects = []
  const create = (_options, callbacks) => {
    const value = {
      callbacks,
      closed: 0,
      connect() {},
      close() {
        this.closed++
      },
      sendText() {},
    }
    sessions.push(value)
    return value
  }
  const first = createMuseDockRuntime(create, () => 'fixture')
  first.onContextCreated({
    ui: {
      showBalloon(text) {
        effects.push(text)
      },
    },
    face: {
      setEmotion(value) {
        effects.push(value)
      },
    },
  })
  first.connect()
  first.close()
  first.close()
  sessions[0].callbacks.onSmile()
  sessions[0].callbacks.onText('late')
  assert.deepEqual(effects, [])
  assert.equal(sessions[0].closed, 1)
  assert.throws(() => first.connect())
  const second = createMuseDockRuntime(create, () => 'fixture')
  second.onContextCreated({
    ui: { showBalloon() {} },
    face: {
      setEmotion(value) {
        effects.push(value)
      },
    },
  })
  second.connect()
  sessions[1].callbacks.onSmile()
  assert.deepEqual(effects, [3])
  second.close()
})

test('missing configuration never opens a socket', () => {
  const f = fixture()
  delete f.session.options.token
  assert.throws(() => f.session.connect())
  assert.equal(f.sockets.length, 0)
})

test('dock reconnect ignores callbacks retained by the previous connection', () => {
  const callbacks = [],
    effects = []
  const dock = createMuseDockRuntime(
    (_options, handlers) => {
      callbacks.push(handlers)
      return { connect() {}, close() {}, sendText() {} }
    },
    () => 'fixture',
  )
  dock.onContextCreated({
    ui: {
      showBalloon(text) {
        effects.push(text)
      },
    },
    face: {
      setEmotion(value) {
        effects.push(value)
      },
    },
  })
  dock.connect()
  dock.connect()
  callbacks[0].onSmile()
  callbacks[0].onText('stale')
  callbacks[1].onSmile()
  assert.deepEqual(effects, [3])
  dock.disconnect()
  callbacks[1].onSmile()
  assert.deepEqual(effects, [3])
  dock.close()
})
