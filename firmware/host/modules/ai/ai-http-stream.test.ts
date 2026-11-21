import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createVoiceScope, deferred } from '../voice/scope.js'
import type { ResponseConnection, ResponseWriter } from './ai-http-stream.js'

const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier.startsWith('stackchan-ai-')
      ? { shortCircuit: true, url: new URL(`./${specifier.slice(10)}.js`, import.meta.url).href }
      : next(specifier, context)
  },
})
const { streamResponse } = await import('./ai-http-stream.js')
const { createResponsesLLM } = await import('./ai-responses.js')
hooks.deregister()
ArrayBuffer.fromString ??= (value) => new TextEncoder().encode(value).buffer
String.fromArrayBuffer ??= (value) => new TextDecoder().decode(value)

const body = { length: 0, *read() {} }
const turn = () => new Promise<void>((resolve) => setImmediate(resolve))

function fixture(
  maxBytes = 64,
  idleTimeout = false,
  diagnostic?: { now(): number; emit(values: number[]): void },
  readAhead = false,
) {
  let handlers!: Parameters<ResponseConnection['request']>[0]
  let disconnect!: (error?: unknown) => void
  const unread: number[] = []
  let valid = true
  let closes = 0
  let sequence = 0
  const reads: number[] = []
  const readBuffers = new Set<ArrayBufferLike>()
  let shortRead = false
  const jobs = new Map<number, { task(): void; ms: number }>()
  function read(target: number): ArrayBuffer | undefined
  function read(target: Uint8Array): number | undefined
  function read(target: number | Uint8Array): ArrayBuffer | number | undefined {
    const count = typeof target === 'number' ? target : target.byteLength
    if (typeof target !== 'number') {
      readBuffers.add(target.buffer)
      if (shortRead) return 0
    }
    assert.ok(valid, 'read after request completion')
    assert.ok(count > 0 && count <= unread.length, 'read exceeds current snapshot')
    reads.push(count)
    const data = Uint8Array.from(unread.splice(0, count))
    if (typeof target === 'number') return data.buffer
    target.set(data)
    return count
  }
  const writer: ResponseWriter = {
    read,
    write: () => 0,
  }
  const send = streamResponse(
    {
      path: '/v1/responses',
      diagnostic,
      connect(onError) {
        disconnect = onError
        return {
          request(options) {
            handlers = options
          },
          close() {
            valid = false
            closes++
          },
        }
      },
      schedule(task, ms) {
        jobs.set(++sequence, { task, ms })
        return sequence
      },
      clear(id) {
        jobs.delete(id)
      },
    },
    '',
    5000,
    maxBytes,
    idleTimeout,
    readAhead,
  )
  return {
    send,
    reads,
    readBuffers,
    shortRead() {
      shortRead = true
    },
    headers: () => handlers.onHeaders(200),
    push(bytes: Uint8Array) {
      unread.push(...bytes)
      handlers.onReadable.call(writer, unread.length)
    },
    notify() {
      handlers.onReadable.call(writer, unread.length)
    },
    end(error?: Error) {
      valid = false
      handlers.onDone(error)
      if (error) disconnect(error)
    },
    requestDone(error?: Error) {
      valid = false
      handlers.onDone(error)
    },
    socketError(error: Error) {
      valid = false
      disconnect(error)
    },
    tick(ms = 0) {
      for (const [id, job] of [...jobs]) {
        if (job.ms <= ms && jobs.delete(id)) job.task()
      }
    },
    get remaining() {
      return unread.length
    },
    get closes() {
      return closes
    },
  }
}

for (const maxBytes of [512, 16384]) {
  test(`Responses pauses reads while an SSE observer waits within ${maxBytes} bytes`, async () => {
    const io = fixture(maxBytes)
    const held = deferred<void>()
    const seen: string[] = []
    const model = createResponsesLLM({ model: 'test', provider: 'test', send: io.send })
    const task = model.createResponse(
      { input: [] },
      {
        ...createVoiceScope(),
        async onEvent(event) {
          seen.push(event.delta)
          if (seen.length === 1) await held.promise
        },
      },
    )
    const outcome = task.then(
      (value) => value,
      (error) => error,
    )
    const event = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
    const delta = { type: 'response.output_text.delta', item_id: 'message', delta: 'はい' }
    io.headers()
    io.push(event(delta))
    await turn()
    assert.deepEqual(seen, ['はい'])
    for (let index = 0; index < 20; index++) {
      io.push(event(delta))
      io.notify()
    }
    const response = { id: 'response', status: 'completed', output: [] }
    io.push(event({ type: 'response.completed', response }))
    assert.equal(io.reads.length, 1)
    assert.equal(io.closes, 0)
    held.resolve()
    await turn()
    io.tick()
    assert.deepEqual(await outcome, { ...response, usage: undefined })
    assert.equal(seen.length, 21)
    assert.equal(io.remaining, 0)
    assert.ok(io.reads.every((count) => count <= maxBytes))
    assert.equal(io.closes, 1)
  })
}

test('HTTP splits a notification larger than the byte budget and defers consumers beyond the callback', async () => {
  const io = fixture(7)
  const expected = Uint8Array.from({ length: 50 }, (_, index) => index)
  const received: number[] = []
  let inCallback = false
  const task = io.send(
    body,
    async (bytes) => {
      assert.equal(inCallback, false)
      received.push(...bytes)
    },
    createVoiceScope(),
  )
  io.headers()
  inCallback = true
  io.push(expected)
  inCallback = false
  await turn()
  assert.deepEqual(received, [...expected])
  assert.equal(io.remaining, 0)
  assert.ok(io.reads.every((count) => count <= 7))
  io.end()
  await turn()
  io.tick()
  await task
  assert.equal(io.closes, 1)
})

test('HTTP EOF waits for the final accepted consumer', async () => {
  const io = fixture()
  const held = deferred<void>()
  const task = io.send(body, () => held.promise, createVoiceScope())
  let settled = false
  void task.then(() => {
    settled = true
  })
  io.headers()
  io.push(Uint8Array.of(1))
  io.end()
  await turn()
  io.tick()
  assert.equal(settled, false)
  held.resolve()
  await turn()
  io.tick()
  await task
  assert.equal(io.closes, 1)
})

test('HTTP error invalidates unread data but drains an accepted terminal event before failing', async () => {
  for (const terminal of [false, true]) {
    const io = fixture(4)
    const held = deferred<void>()
    let complete = false
    const task = io.send(
      body,
      async () => {
        await held.promise
        complete = terminal
      },
      createVoiceScope(),
      () => complete,
    )
    const outcome = task.then(
      () => undefined,
      (error) => error,
    )
    io.headers()
    io.push(Uint8Array.of(1, 2, 3, 4, 5, 6))
    await turn()
    io.end(new Error('socket reset'))
    held.resolve()
    await turn()
    io.tick()
    const error = await outcome
    if (terminal) assert.equal(error, undefined)
    else assert.match(error.message, /socket reset/)
    assert.deepEqual(io.reads, [4])
    assert.equal(io.remaining, 2)
    assert.equal(io.closes, 1)
  }
})

test('HTTP abort and deadline settle while a consumer is held and never resume reads afterward', async () => {
  for (const abort of [false, true]) {
    const io = fixture(4)
    const held = deferred<void>()
    const scope = createVoiceScope()
    const task = io.send(body, () => held.promise, scope)
    const outcome = task.then(
      () => undefined,
      (error) => error,
    )
    io.headers()
    io.push(Uint8Array.of(1, 2, 3, 4, 5, 6))
    await turn()
    if (abort) scope.abort()
    else io.tick(5000)
    io.tick()
    assert.equal((await outcome).code, abort ? 'cancelled' : 'deadline_exceeded')
    held.resolve()
    await turn()
    io.notify()
    assert.deepEqual(io.reads, [4])
    assert.equal(io.closes, 1)
  }
})

test('HTTP consumer failure closes once without reading the retained remainder', async () => {
  const io = fixture(4)
  const error = new Error('observer failed')
  const task = io.send(
    body,
    async () => {
      throw error
    },
    createVoiceScope(),
  )
  const outcome = task.then(
    () => undefined,
    (cause) => cause,
  )
  io.headers()
  io.push(Uint8Array.of(1, 2, 3, 4, 5, 6))
  await turn()
  io.tick()
  assert.equal(await outcome, error)
  io.notify()
  assert.deepEqual(io.reads, [4])
  assert.equal(io.closes, 1)
})

test('idle deadline excludes intentional consumer backpressure and resumes afterwards', async () => {
  const io = fixture(64, true)
  const held = deferred<void>()
  const task = io.send(body, async () => held.promise, createVoiceScope())
  const outcome = task.catch((error) => error)
  io.headers()
  io.push(Uint8Array.of(1, 2))
  await turn()
  io.tick(5000)
  assert.equal(io.closes, 0)
  held.resolve()
  await turn()
  io.tick(5000)
  io.tick()
  assert.equal((await outcome).code, 'deadline_exceeded')
  assert.equal(io.closes, 1)
})

test('transport diagnostics retain counters but never exception contents', async () => {
  let clock = 10
  const reports: number[][] = []
  const io = fixture(4, false, { now: () => clock, emit: (values) => reports.push(values) })
  const held = deferred<void>()
  const task = io.send(body, () => held.promise, createVoiceScope())
  const outcome = task.catch((error) => error)
  io.headers()
  io.push(Uint8Array.of(1, 2, 3, 4, 5, 6))
  await turn()
  clock = 40
  io.end(new Error('private-token'))
  assert.deepEqual(reports[0], [2, 1, 200, 4, 2, 6, 30, 0, 0, 30])
  assert.deepEqual(reports[1], [1, 1, 200, 4, 0, 6, 30, 0, 0, 30])
  held.resolve()
  await turn()
  io.tick()
  await outcome
  assert.ok(reports.every((row) => row.length === 10 && row.every(Number.isFinite)))
  assert.ok(!JSON.stringify(reports).includes('private-token'))
})

for (const order of ['request-first', 'socket-first'] as const) {
  for (const unreadTerminal of [false, true]) {
    test(`HTTP ${order} preserves owned terminal but rejects invalidated unread terminal=${unreadTerminal}`, async () => {
      const event = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
      const delta = event({ type: 'response.output_text.delta', item_id: 'message', delta: 'fixture' })
      const response = { id: 'response', status: 'completed', output: [] }
      const terminal = event({ type: 'response.completed', response })
      const combined = new Uint8Array(delta.length + terminal.length)
      combined.set(delta)
      combined.set(terminal, delta.length)
      const io = fixture(unreadTerminal ? delta.length : combined.length)
      const held = deferred<void>()
      const seen: string[] = []
      const model = createResponsesLLM({ model: 'test', provider: 'test', send: io.send })
      let settlements = 0
      const outcome = model
        .createResponse(
          { input: [] },
          {
            ...createVoiceScope(),
            async onEvent(value) {
              seen.push(value.delta)
              await held.promise
            },
          },
        )
        .then(
          (value) => {
            settlements++
            return { value, error: undefined }
          },
          (error) => {
            settlements++
            return { value: undefined, error }
          },
        )
      io.headers()
      io.push(combined)
      await turn()
      assert.deepEqual(seen, ['fixture'])
      const error = new Error('fixture close')
      if (order === 'request-first') {
        io.requestDone(error)
        io.socketError(error)
      } else {
        io.socketError(error)
        io.requestDone(error)
      }
      await turn()
      assert.equal(settlements, 0)
      held.resolve()
      await turn()
      io.tick()
      const result = await outcome
      if (unreadTerminal) {
        assert.equal(result.error.code, 'provider_failed')
        assert.equal(result.value, undefined)
        assert.equal(io.remaining, terminal.length)
      } else {
        assert.equal(result.error, undefined)
        assert.deepEqual(result.value, { ...response, usage: undefined })
        assert.equal(io.remaining, 0)
      }
      io.socketError(error)
      io.requestDone(error)
      io.tick()
      await turn()
      assert.equal(settlements, 1)
      assert.equal(io.closes, 1)
    })
  }
}

test('clean HTTP completion with an invalidated unread terminal cannot falsely complete an application response', async () => {
  const event = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
  const delta = event({ type: 'response.output_text.delta', item_id: 'message', delta: 'fixture' })
  const terminal = event({ type: 'response.completed', response: { id: 'r', status: 'completed', output: [] } })
  const io = fixture(delta.length)
  const held = deferred<void>()
  const model = createResponsesLLM({ model: 'test', provider: 'test', send: io.send })
  const outcome = model
    .createResponse(
      { input: [] },
      {
        ...createVoiceScope(),
        onEvent: async () => held.promise,
      },
    )
    .catch((error) => error)
  io.headers()
  io.push(delta)
  await turn()
  io.push(terminal)
  io.requestDone()
  held.resolve()
  await turn()
  io.tick()
  assert.equal((await outcome).code, 'provider_failed')
  assert.equal(io.remaining, terminal.length)
  assert.equal(io.closes, 1)
})

for (const hasTerminal of [true, false]) {
  test(`bounded worker read-ahead drains announced bytes across SDK invalidation: terminal=${hasTerminal}`, async () => {
    const io = fixture(16384, true, undefined, true)
    const held = deferred<void>()
    const seen: number[] = []
    let complete = false
    const req = io.send(
      body,
      async (bytes) => {
        seen.push(...bytes)
        await held.promise
        if (bytes.at(-1) === 23) complete = true
      },
      createVoiceScope(),
      () => complete,
    )
    const outcome = req.then(
      () => undefined,
      (err) => err,
    )
    io.headers()
    io.push(Uint8Array.of(1, 2, 3))
    await turn()
    io.push(Uint8Array.of(4, hasTerminal ? 23 : 22))
    io.end(new Error('peer closed'))
    held.resolve()
    await turn()
    io.tick()
    const error = await outcome
    if (hasTerminal) assert.equal(error, undefined)
    else assert.match(error.message, /peer closed/)
    assert.deepEqual(seen, [1, 2, 3, 4, hasTerminal ? 23 : 22])
    assert.equal(io.closes, 1)
  })
}
test('worker read-ahead in flight stays within the configured budget and preserves every byte in order', async () => {
  const io = fixture(16384, true, undefined, true)
  const held = deferred<void>()
  const received: number[] = []
  const req = io.send(
    body,
    async (bytes) => {
      await held.promise
      received.push(...bytes)
    },
    createVoiceScope(),
  )
  io.headers()
  const source = Uint8Array.from({ length: 24576 }, (_, i) => i % 251)
  io.push(source.subarray(0, 4096))
  await turn()
  for (let i = 4096; i < source.length; i += 128) io.push(source.subarray(i, i + 128))
  assert.ok(io.remaining >= source.length - 16384)
  assert.ok(io.remaining > 0)
  held.resolve()
  await turn()
  io.end()
  await turn()
  io.tick()
  await req
  assert.deepEqual(received, [...source])
  assert.equal(io.readBuffers.size, 1)
  assert.equal([...io.readBuffers][0].byteLength, 16384)
})

test('worker telemetry distinguishes an empty receive queue from deliberate consumer waits', async () => {
  let ms = 0
  const reports: number[][] = []
  const io = fixture(16384, true, { now: () => ms, emit: (v) => reports.push(v) }, true)
  const held = deferred<void>()
  const req = io.send(
    body,
    async (bytes) => {
      if (bytes[0] === 1) await held.promise
    },
    createVoiceScope(),
  )
  io.headers()
  io.push(Uint8Array.of(1))
  await turn()
  ms = 7
  io.push(Uint8Array.of(2))
  ms = 20
  held.resolve()
  await turn()
  ms = 45
  io.push(Uint8Array.of(3))
  await turn()
  io.end()
  await turn()
  io.tick()
  await req
  assert.deepEqual(
    reports.find((v) => v[0] === 4),
    [4, 200, 3, 45, 25, 25, 38, 2, 1, 0],
  )
})

test('read-ahead owns a small terminal after 12 KiB of fragmented PCM before SDK invalidation', async () => {
  const io = fixture(16384, true, undefined, true)
  const held = deferred<void>()
  const received: number[] = []
  let complete = false
  const source = Uint8Array.from({ length: 12288 + 83 }, (_, i) => (i === 12288 + 82 ? 255 : i % 251))
  const outcome = io
    .send(
      body,
      async (bytes) => {
        await held.promise
        received.push(...bytes)
        if (bytes.at(-1) === 255) complete = true
      },
      createVoiceScope(),
      () => complete,
    )
    .catch((error) => error)
  io.headers()
  io.push(source.subarray(0, 4096))
  await turn()
  for (let i = 4096; i < source.length; i += 128) io.push(source.subarray(i, i + 128))
  const unreadAtClose = io.remaining
  io.end(new Error('peer closed'))
  held.resolve()
  await turn()
  io.tick()
  const result = await outcome
  assert.equal(unreadAtClose, 0)
  assert.equal(result, undefined)
  assert.deepEqual(received, [...source])
  assert.equal(io.readBuffers.size, 1)
  assert.equal([...io.readBuffers][0].byteLength, 16384)
})

test('ring saturation cannot turn an invalidated unread terminal into success', async () => {
  const io = fixture(16384, true, undefined, true)
  const held = deferred<void>()
  let complete = false
  const outcome = io
    .send(
      body,
      async (bytes) => {
        await held.promise
        if (bytes.at(-1) === 255) complete = true
      },
      createVoiceScope(),
      () => complete,
    )
    .catch((error) => error)
  io.headers()
  io.push(new Uint8Array(16384))
  await turn()
  io.push(Uint8Array.of(255))
  assert.equal(io.remaining, 1)
  io.end(new Error('peer closed'))
  held.resolve()
  await turn()
  io.tick()
  assert.equal((await outcome).code, 'provider_failed')
  assert.equal(complete, false)
})

test('direct ring short read fails without passing uninitialized data to the consumer', async () => {
  const io = fixture(16384, true, undefined, true)
  let calls = 0
  const outcome = io
    .send(
      body,
      async () => {
        calls++
      },
      createVoiceScope(),
    )
    .catch((error) => error)
  io.headers()
  io.shortRead()
  io.push(Uint8Array.of(1, 2, 3))
  await turn()
  io.tick()
  assert.match((await outcome).message, /short HTTP read/)
  assert.equal(calls, 0)
  assert.equal(io.closes, 1)
})

test('aborting held ring consumer never refills or overwrites its view', async () => {
  const io = fixture(16384, true, undefined, true)
  const scope = createVoiceScope()
  const held = deferred<void>()
  const seen: number[] = []
  const outcome = io
    .send(
      body,
      async (bytes) => {
        await held.promise
        seen.push(...bytes)
      },
      scope,
    )
    .catch((error) => error)
  io.headers()
  io.push(Uint8Array.of(1, 2, 3))
  await turn()
  io.push(new Uint8Array(20000))
  const readCount = io.reads.length
  scope.abort()
  io.tick()
  assert.equal((await outcome).code, 'cancelled')
  held.resolve()
  await turn()
  assert.equal(io.reads.length, readCount)
  assert.deepEqual(seen, [1, 2, 3])
})
