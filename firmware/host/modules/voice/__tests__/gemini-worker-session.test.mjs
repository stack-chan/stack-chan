import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test, { beforeEach } from 'node:test'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'timer') return next(new URL('../../testing/fakes/timer.ts', import.meta.url).href, context)
    if (specifier.startsWith('stackchan/voice/'))
      return next(new URL(`../${specifier.slice(16)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { createGeminiWorkerTTS } = await import('../gemini-worker-session.js')
const { createVoiceScope, deferred } = await import('../scope.ts')
const { mono, subscribePcmSource } = await import('../media.ts')
const { default: Timer } = await import('../../testing/fakes/timer.ts')
const tick = () => new Promise((resolve) => setImmediate(resolve))
beforeEach(() => Timer.reset())
async function fixture(startJob, options = {}, consumer = {}) {
  const scope = createVoiceScope()
  const session = await createGeminiWorkerTTS(options, startJob).open({ ...scope, format: mono(24000), voice: 'Leda' })
  const heard = [],
    ends = []
  subscribePcmSource(session.output, {
    write:
      consumer.write ??
      ((bytes) => {
        heard.push(...bytes)
      }),
    end: (error) => ends.push(error),
  })
  return { session, scope, heard, ends }
}
test('flush is reusable, endInput seals input and preserves concurrent tail ordering', async () => {
  const gate = deferred(),
    requests = []
  const f = await fixture(async (job) => {
    requests.push(job.text)
    if (job.text === 'first') await gate.promise
    await job.onPcm(Uint8Array.of(1, 2))
  })
  await f.session.write('first')
  const first = f.session.flush()
  await tick()
  await f.session.write('tail')
  const done = f.session.endInput()
  assert.equal(f.session.endInput(), done)
  await assert.rejects(f.session.write('late'), { code: 'cancelled' })
  assert.deepEqual(requests, ['first'])
  gate.resolve()
  await Promise.all([first, done])
  assert.deepEqual(requests, ['first', 'tail'])
  assert.deepEqual(f.heard, [1, 2, 1, 2])
  assert.deepEqual(f.ends, [undefined])
  await f.session.close()
})
test('flush waits for PCM consumer, without ending the source', async () => {
  const gate = deferred()
  const f = await fixture(async ({ onPcm }) => onPcm(Uint8Array.of(0, 1)), {}, { write: () => gate.promise })
  await f.session.write('hello')
  let settled = false
  const flush = f.session.flush().then(() => {
    settled = true
  })
  await tick()
  assert.equal(settled, false)
  gate.resolve()
  await flush
  assert.equal(f.ends.length, 0)
  await f.session.endInput()
})
test('close releases a hung consumer and prevents late delivery', async () => {
  const gate = deferred()
  let writes = 0
  const f = await fixture(
    async ({ onPcm }) => {
      await onPcm(Uint8Array.of(0, 1))
      await onPcm(Uint8Array.of(2, 3))
    },
    {},
    {
      write() {
        writes++
        return gate.promise
      },
    },
  )
  await f.session.write('hello')
  const flush = f.session.flush()
  const rejected = assert.rejects(flush, { code: 'cancelled' })
  await tick()
  await f.session.close()
  await rejected
  gate.resolve()
  await tick()
  assert.equal(writes, 1)
  assert.equal(f.ends[0].code, 'cancelled')
})
test('deadline aborts provider and stuck consumer with a fixed code', async () => {
  let signal
  const f = await fixture(
    async (job) => {
      signal = job.signal
      await new Promise(() => {})
    },
    { timeoutMs: 10 },
  )
  await f.session.write('hello')
  const flush = f.session.flush()
  const rejected = assert.rejects(flush, { code: 'deadline_exceeded' })
  await tick()
  Timer.advance(10)
  await rejected
  assert.equal(signal.aborted, true)
  assert.equal(f.ends[0].code, 'deadline_exceeded')
})
test('parent abort and provider failure are terminal, observers cannot break output', async () => {
  const f = await fixture(
    async ({ onMetrics, onFailure, onPcm }) => {
      onMetrics({ pcmBytes: 2 })
      onFailure(4)
      await onPcm(Uint8Array.of(1, 2))
    },
    {
      onMetrics() {
        throw Error('observer')
      },
      onFailure() {
        throw Error('observer')
      },
    },
  )
  await f.session.write('one')
  await f.session.flush()
  f.scope.abort()
  await assert.rejects(f.session.write('two'), { code: 'cancelled' })
  const bad = await fixture(async () => {
    throw Error('private provider content')
  })
  await bad.session.write('hello')
  await assert.rejects(bad.session.endInput(), { code: 'provider_failed', message: 'provider_failed' })
})
test('empty input has no request, options and PCM format validate', async () => {
  const f = await fixture(async () => assert.fail('no job'))
  await f.session.endInput()
  assert.deepEqual(f.ends, [undefined])
  assert.throws(() => createGeminiWorkerTTS({}, null), TypeError)
  assert.throws(() => createGeminiWorkerTTS({ timeoutMs: 0 }, () => {}), RangeError)
  assert.throws(() => createGeminiWorkerTTS({ maxEventBytes: 1 }, () => {}), RangeError)
  await assert.rejects(createGeminiWorkerTTS({}, () => {}).open({ ...createVoiceScope(), format: mono(16000) }), {
    code: 'unsupported_capability',
  })
})
test('bounded queue, surrogate-safe segments and requested configuration', async () => {
  const requests = []
  const f = await fixture(async (job) => requests.push(job), { model: 'model', instructions: 'style' })
  const text = `${'a'.repeat(1023)}😀${'b'.repeat(2048)}`
  await f.session.write(text)
  await f.session.endInput()
  assert.equal(requests.map((r) => r.text).join(''), text)
  assert.ok(requests.every((r) => r.text.length <= 1024 && !/[\ud800-\udbff]$/.test(r.text)))
  assert.ok(requests.every((r) => r.voice === 'Leda' && r.model === 'model' && r.instructions === 'style'))
  const full = await fixture(async () => {})
  await full.session.write('x'.repeat(8192))
  await assert.rejects(full.session.write('x'), { code: 'resource_exhausted' })
  await assert.rejects(full.session.endInput(), { code: 'resource_exhausted' })
})

test('per-chunk cancellation registrations are released during long streams', async () => {
  let active = 0,
    maximum = 0
  const f = await fixture(
    async ({ signal, onPcm }) => {
      const add = signal.addEventListener.bind(signal),
        remove = signal.removeEventListener.bind(signal)
      const tracked = new Set()
      signal.addEventListener = (type, listener) => {
        tracked.add(listener)
        active++
        maximum = Math.max(maximum, active)
        add(type, listener)
      }
      signal.removeEventListener = (type, listener) => {
        if (tracked.delete(listener)) active--
        remove(type, listener)
      }
      for (let i = 0; i < 10000; i++) await onPcm(Uint8Array.of(0, 0))
      assert.equal(active, 0)
    },
    {},
    { async write() {} },
  )
  await f.session.write('long stream')
  await f.session.endInput()
  assert.ok(maximum <= 1)
  assert.equal(maximum, 1)
})

const progressDeadline = { timeoutMs: 120000, pcmIdleTimeoutMs: 45000 }

test('accepted PCM lets native synthesis finish after the ordinary deadline', async () => {
  for (const timeout of [{}, progressDeadline]) {
    const f = await fixture(async ({ onPcm }) => {
      Timer.advance(42000)
      await onPcm(Uint8Array.of(1, 2))
      Timer.advance(4000)
      await onPcm(Uint8Array.of(3, 4))
    }, timeout)
    await f.session.write('long reply')
    if (timeout === progressDeadline) {
      await f.session.endInput()
      assert.deepEqual(f.heard, [1, 2, 3, 4])
      assert.deepEqual(f.ends, [undefined])
    } else {
      await assert.rejects(f.session.endInput(), { code: 'deadline_exceeded' })
      assert.deepEqual(f.heard, [1, 2])
    }
  }
})

test('metadata, empty PCM and blocked writes do not keep synthesis alive', async () => {
  const blockedWrite = deferred()
  let signal
  const f = await fixture(
    async (job) => {
      signal = job.signal
      Timer.advance(10000)
      await job.onPcm(Uint8Array.of(1, 2))
      Timer.advance(44999)
      job.onMetrics({ pcmBytes: 987 })
      await job.onPcm(new Uint8Array())
      await job.onPcm(Uint8Array.of(3, 4))
    },
    progressDeadline,
    {
      write(bytes) {
        if (bytes[0] === 3) return blockedWrite.promise
      },
    },
  )
  await f.session.write('response stalled')
  const expired = assert.rejects(f.session.endInput(), { code: 'deadline_exceeded' })
  await tick()
  assert.equal(signal.aborted, false)
  Timer.advance(1)
  await expired
  blockedWrite.resolve()
  assert.equal(f.ends.length, 1)
  assert.equal(f.ends[0].code, 'deadline_exceeded')
})

test('the total synthesis deadline holds even with regular PCM progress', async () => {
  const f = await fixture(async ({ onPcm }) => {
    for (let index = 0; index < 3; index++) {
      Timer.advance(39999)
      await onPcm(Uint8Array.of(index, 0))
    }
    Timer.advance(3)
    await onPcm(Uint8Array.of(3, 0))
  }, progressDeadline)
  await f.session.write('response still producing audio')
  await assert.rejects(f.session.endInput(), { code: 'deadline_exceeded' })
  assert.deepEqual(f.heard, [0, 0, 1, 0, 2, 0])
})
