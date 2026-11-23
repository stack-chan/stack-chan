import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSlotWriter,
  createWorkerDiagnostics,
  runWorkerJob,
  slotBytes,
  slotCount,
} from '../gemini-worker-bridge.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(onPcm, diagnostics = {}) {
  const controller = new AbortController()
  let worker,
    slots,
    terminated = 0,
    reap,
    cancels = 0,
    start
  const job = runWorkerJob(
    {
      signal: controller.signal,
      text: 'test',
      onPcm,
      onMetrics: diagnostics.onMetrics,
      onFailure: diagnostics.onFailure,
    },
    { endpoint: 'http://localhost', onTransport: diagnostics.onTransport },
    {
      spawn: () =>
        (worker = {
          postMessage(message) {
            if (message.type === 'start') {
              start = message
              slots = createSlotWriter(message.ring, (value) => queueMicrotask(() => worker.onmessage(value)))
            }
            if (message.type === 'ack') slots.ack(message.seq)
            if (message.type === 'cancel') {
              cancels++
              slots.cancel()
            }
          },
          terminate() {
            terminated++
          },
        }),
      schedule(fn) {
        reap = fn
        return 1
      },
      clear() {
        reap = undefined
      },
    },
  )
  return {
    controller,
    worker,
    slots,
    job,
    start,
    terminated: () => terminated,
    reap: () => reap,
    cancels: () => cancels,
  }
}

test('four bounded slots never overwrite borrowed PCM, then drain before completion', async () => {
  let release
  const gate = new Promise((r) => {
      release = r
    }),
    received = []
  const f = fixture(async (bytes) => {
    if (!received.length) await gate
    received.push([...bytes])
  })
  assert.equal(f.start.ring.byteLength, slotCount * slotBytes)
  let issued = 0
  const produce = (async () => {
    for (let i = 0; i < 40; i++) {
      await f.slots.write(Uint8Array.of(i, i))
      issued++
    }
    await f.slots.drain()
    f.worker.onmessage({ type: 'done' })
  })()
  await tick()
  assert.equal(issued, slotCount)
  release()
  await Promise.all([produce, f.job])
  assert.deepEqual(
    received,
    Array.from({ length: 40 }, (_, i) => [i, i]),
  )
  assert.equal(f.terminated(), 1)
})

test('abort while consumer and producer are backpressured wakes producer; late writes are suppressed', async () => {
  let calls = 0,
    release
  const f = fixture(() => {
    calls++
    return new Promise((r) => {
      release = r
    })
  })
  for (let i = 0; i < slotCount; i++) await f.slots.write(Uint8Array.of(1, 2))
  const blocked = f.slots.write(Uint8Array.of(3, 4))
  await tick()
  f.controller.abort(Object.assign(Error(), { code: 'cancelled' }))
  await assert.rejects(f.job, { code: 'cancelled' })
  await assert.rejects(blocked, { code: 'cancelled' })
  assert.equal(f.cancels(), 1)
  assert.equal(f.terminated(), 0)
  f.worker.onmessage({ type: 'error', code: 'cancelled' })
  release()
  await tick()
  assert.equal(calls, 1)
  assert.equal(f.terminated(), 1)
  assert.equal(f.reap(), undefined)
})

test('a failed consumer stops further output and reaps a nonresponding worker', async () => {
  const f = fixture(() => {
    throw Error('consumer unavailable')
  })
  await f.slots.write(Uint8Array.of(1, 2))
  await assert.rejects(f.job, /consumer unavailable/)
  assert.equal(f.cancels(), 1)
  f.reap()()
  f.worker.onmessage({ type: 'error', code: 'cancelled' })
  assert.equal(f.terminated(), 1)
})

test('unexpected sequence or slot length fails closed without touching PCM', async () => {
  for (const bad of [
    { seq: 1, slot: 1, length: 2 },
    { seq: 0, slot: 0, length: slotBytes + 2 },
  ]) {
    const f = fixture(() => assert.fail('unexpected PCM'))
    f.worker.onmessage({ type: 'pcm', ...bad })
    await assert.rejects(f.job, { code: 'provider_failed' })
    f.reap()()
  }
})

test('counts time waiting for exhausted credits separately from intervals between PCM posts', async () => {
  let ms = 0
  const writer = createSlotWriter(
    new SharedArrayBuffer(slotBytes * slotCount),
    () => {},
    () => ms,
  )
  const chunk = Uint8Array.of(0, 0)
  for (let i = 0; i < slotCount; i++) {
    ms += 3
    await writer.write(chunk)
  }
  ms += 7
  const blocked = writer.write(chunk)
  ms += 11
  writer.ack(0)
  await blocked
  assert.deepEqual(writer.metrics, { waits: 1, waitTotal: 11, waitMax: 11, postGapMax: 18 })
})

test('immediate writer copies free slots synchronously and waits before reusing borrowed storage', async () => {
  const ring = new SharedArrayBuffer(slotBytes * slotCount)
  const messages = []
  const writer = createSlotWriter(ring, (message) => messages.push(message))
  const bytes = Uint8Array.of(1, 2)
  for (let i = 0; i < slotCount; i++) assert.equal(writer.writeImmediate(bytes), undefined)
  bytes[0] = 9
  assert.equal(new Uint8Array(ring)[0], 1)
  const pending = writer.writeImmediate(bytes)
  assert.equal(typeof pending.then, 'function')
  assert.equal(messages.length, 4)
  assert.equal(new Uint8Array(ring)[0], 1)
  writer.ack(0)
  await pending
  assert.equal(messages.length, 5)
  assert.equal(new Uint8Array(ring)[0], 9)
  assert.deepEqual(
    messages.map(({ seq }) => seq),
    [0, 1, 2, 3, 4],
  )
  writer.cancel()
  assert.throws(() => writer.writeImmediate(bytes), { code: 'cancelled' })
  await assert.rejects(writer.write(bytes), { code: 'cancelled' })
})

test('immediate writer wakes a full-ring wait on cancellation without posting', async () => {
  let sent = 0
  const writer = createSlotWriter(new SharedArrayBuffer(slotBytes * slotCount), () => sent++)
  for (let i = 0; i < slotCount; i++) writer.writeImmediate(Uint8Array.of(i, i))
  const pending = writer.writeImmediate(Uint8Array.of(8, 8))
  writer.cancel()
  await assert.rejects(pending, { code: 'cancelled' })
  assert.equal(sent, slotCount)
})

test('immediate writer retains exhausted-credit timing and rejects invalid blocks without posting', async () => {
  let ms = 0,
    sent = 0
  const writer = createSlotWriter(
    new SharedArrayBuffer(slotBytes * slotCount),
    () => sent++,
    () => ms,
  )
  const chunk = Uint8Array.of(0, 0)
  for (let i = 0; i < slotCount; i++) {
    ms += 3
    writer.writeImmediate(chunk)
  }
  ms += 7
  const pending = writer.writeImmediate(chunk)
  ms += 11
  writer.ack(0)
  await pending
  assert.deepEqual(writer.metrics, { waits: 1, waitTotal: 11, waitMax: 11, postGapMax: 18 })
  for (const length of [0, 1, slotBytes + 2]) {
    assert.throws(() => writer.writeImmediate(new Uint8Array(length)), { code: 'provider_failed' })
  }
  assert.equal(sent, 5)
})

test('terminal batch replays ordered diagnostics once before success or failure', async () => {
  for (const type of ['done', 'error']) {
    const received = []
    const f = fixture(() => {}, {
      onTransport: (v) => received.push(['transport', v]),
      onMetrics: (v) => received.push(['metrics', v]),
      onFailure: (v) => received.push(['failure', v]),
    })
    const report = createWorkerDiagnostics()
    report.add({ type: 'transport', values: [4, 200] })
    report.add({ type: 'metrics', values: { pcmBytes: 5760 } })
    report.add({ type: 'diagnostic', reason: 0 })
    const terminal = report.finish(type, type === 'error' ? 'provider_failed' : undefined)
    f.worker.onmessage(terminal)
    if (type === 'error') await assert.rejects(f.job, { code: 'provider_failed' })
    else await f.job
    assert.deepEqual(received, [
      ['transport', [4, 200]],
      ['metrics', { pcmBytes: 5760 }],
      ['failure', 0],
    ])
    f.worker.onmessage(terminal)
    assert.equal(received.length, 3)
    assert.equal(f.terminated(), 1)
  }
})

test('terminal diagnostics are bounded and empty terminal works without callbacks', async () => {
  const report = createWorkerDiagnostics()
  for (let reason = 0; reason < 30; reason++) report.add({ type: 'diagnostic', reason })
  const terminal = report.finish('error', 'cancelled')
  assert.equal(terminal.diagnostics.length, 12)
  assert.deepEqual(
    terminal.diagnostics.map((x) => x.reason),
    Array.from({ length: 12 }, (_, i) => i + 18),
  )
  assert.deepEqual(report.finish('done'), { type: 'done' })
  const f = fixture(() => {})
  f.worker.onmessage({ type: 'done' })
  await f.job
})

test('cancelled owner accepts terminal cleanup but does not replay stale diagnostics', async () => {
  const f = fixture(() => {}, { onMetrics: () => assert.fail('stale diagnostics') })
  f.controller.abort(Object.assign(Error(), { code: 'cancelled' }))
  await assert.rejects(f.job, { code: 'cancelled' })
  f.worker.onmessage({ type: 'error', code: 'cancelled', diagnostics: [{ type: 'metrics', values: {} }] })
  assert.equal(f.terminated(), 1)
  assert.equal(f.reap(), undefined)
})

test('worker allocation failure has bounded lifecycle markers before any PCM or metrics', async () => {
  const phases = []
  await assert.rejects(runWorkerJob({ signal: new AbortController().signal }, { onLifecycle: phase => phases.push(phase) }, {
    spawn() { throw Error('private allocation detail') }, schedule() {}, clear() {},
  }))
  assert.deepEqual(phases, ['start', 'allocation_failed'])
})

test('slot view allocation failure never creates a worker', async () => {
  const original = Array.from, phases = []
  let spawned = 0, pending
  try {
    Array.from = () => { throw Error('synthetic slot allocation failure') }
    pending = runWorkerJob({ signal: new AbortController().signal }, { onLifecycle: phase => phases.push(phase) }, {
      spawn() { spawned++; return { terminate() {} } }, schedule() {}, clear() {},
    })
  } finally {
    Array.from = original
  }
  await assert.rejects(pending, /synthetic slot allocation failure/)
  assert.equal(spawned, 0)
  assert.deepEqual(phases, ['start', 'allocation_failed'])
})
