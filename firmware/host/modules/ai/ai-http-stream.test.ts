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

function fixture(maxBytes = 64) {
  let handlers!: Parameters<ResponseConnection['request']>[0]
  let disconnect!: (error?: unknown) => void
  const unread: number[] = []
  let valid = true
  let closes = 0
  let sequence = 0
  const reads: number[] = []
  const jobs = new Map<number, { task(): void; ms: number }>()
  const writer: ResponseWriter = {
    read(count) {
      assert.ok(valid, 'read after request completion')
      assert.ok(count > 0 && count <= unread.length, 'read exceeds current snapshot')
      reads.push(count)
      return Uint8Array.from(unread.splice(0, count)).buffer
    },
    write: () => 0,
  }
  const send = streamResponse(
    {
      path: '/v1/responses',
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
  )
  return {
    send,
    reads,
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
