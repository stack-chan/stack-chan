import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (await readFile(new URL('./output.js', import.meta.url), 'utf8')).replace(
  "import { pcmLevel } from 'muse-stopwatch-levels'",
  `const pcmLevel = bytes => { const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2); let sum = 0; for (const sample of samples) sum += Math.abs(sample); return sum / (samples.length * 32768) }`,
)
const { openOutput } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture({ credit = 4092 * 5, refill = true } = {}) {
  let driver
  globalThis.device = {
    audio: {
      Output: class {
        constructor(options) {
          this.options = options
          this.credit = credit
          this.writes = []
          this.closes = 0
          driver = this
        }
        start() {
          queueMicrotask(() => this.options.onWritable(this.credit))
        }
        write(bytes) {
          assert.ok(bytes.length <= this.credit)
          this.credit -= bytes.length
          this.writes.push(Uint8Array.from(bytes))
          if (refill) queueMicrotask(() => this.grant(bytes.length))
        }
        grant(bytes) {
          this.credit += bytes
          this.options.onWritable(this.credit)
        }
        close() {
          this.closes++
        }
      },
    },
  }
  return () => driver
}

test('initial five DMA credits prefill at volume .25 without a hardware completion', async () => {
  const driver = fixture({ refill: false })
  const out = openOutput(16000, 0.25, 6400)
  let finished = 0
  const run = (async () => {
    for (let i = 0; i < 6; i++) {
      await out.write(new Uint8Array(4092).fill(i))
      finished++
    }
  })()
  await tick()
  assert.equal(driver().volume, 0.25)
  assert.equal(driver().writes.length, 5)
  assert.equal(finished, 5)
  driver().grant(4092)
  await run
  assert.equal(finished, 6)
  assert.deepEqual(
    driver().writes.map((bytes) => bytes[0]),
    [0, 1, 2, 3, 4, 5],
  )
  out.close()
})

test('drain flushes copied partial PCM then seven descriptors of silence', async () => {
  const driver = fixture()
  const out = openOutput(16000, 0.25, 6400)
  const expected = []
  for (let i = 0; i < 7; i++) {
    const bytes = new Uint8Array(768).fill(i + 1)
    expected.push(...bytes)
    await out.write(bytes)
    bytes.fill(255)
  }
  assert.equal(driver().writes.length, 1)
  assert.equal(out.frames, expected.length / 2)
  await out.drain()
  const writes = driver().writes
  assert.deepEqual([...writes[0], ...writes[1]], expected)
  assert.deepEqual(
    writes.slice(2).map((bytes) => bytes.length),
    Array(7).fill(4092),
  )
  assert.ok(writes.slice(2).every((bytes) => bytes.every((value) => value === 0)))
  assert.equal(out.frames, expected.length / 2)
  out.close()
  out.close()
  assert.equal(driver().closes, 1)
})

test('no credit blocks a full stage and rejects overlapping write/drain', async () => {
  const driver = fixture({ credit: 0, refill: false })
  const out = openOutput(16000, 0.25, 4092)
  let accepted = 0,
    settled = false
  const writing = out
    .write(new Uint8Array(4092), (count) => {
      accepted += count
    })
    .then(() => {
      settled = true
    })
  await tick()
  assert.equal(accepted, 4092)
  assert.equal(settled, false)
  await assert.rejects(out.write(new Uint8Array(2)), RangeError)
  await assert.rejects(out.drain(), /write still pending/)
  driver().grant(4092)
  await writing
  await assert.rejects(out.write(new Uint8Array(4094)), RangeError)
  out.close()
})

test('close rejects a waiting write and ignores late credits', async () => {
  const driver = fixture({ credit: 0, refill: false })
  const out = openOutput(16000, 0.25, 4092)
  const writing = out.write(new Uint8Array(4092))
  out.close()
  await assert.rejects(writing, { code: 'cancelled' })
  driver().grant(4092)
  await tick()
  assert.equal(driver().writes.length, 0)
})

test('close discards a partial stage and rejects later drain/write', async () => {
  const driver = fixture()
  const out = openOutput(16000, 0.25, 4092)
  await out.write(new Uint8Array(768))
  out.close()
  await assert.rejects(out.drain(), { code: 'cancelled' })
  await assert.rejects(out.write(new Uint8Array(2)), { code: 'cancelled' })
  assert.equal(driver().writes.length, 0)
})

test('drain shares its pending promise and close releases its credit wait', async () => {
  const driver = fixture({ credit: 4092, refill: false })
  const out = openOutput(16000, 0.25, 4092)
  const draining = out.drain()
  assert.equal(out.drain(), draining)
  await tick()
  await assert.rejects(out.write(new Uint8Array(2)), RangeError)
  assert.equal(driver().writes.length, 1)
  out.close()
  await assert.rejects(draining, { code: 'cancelled' })
  driver().grant(4092)
  await tick()
  assert.equal(driver().writes.length, 1)
})

test('partial credit preserves exact PCM and acceptance reads before caller reuse', async () => {
  const driver = fixture({ credit: 1024, refill: false })
  const levels = [],
    out = openOutput(16000, 0.25, 4092, (level) => levels.push(level))
  const bytes = new Uint8Array(4092).fill(51)
  const writing = out.write(bytes, () => bytes.fill(255))
  await tick()
  assert.deepEqual(levels, [])
  assert.equal(driver().writes[0].length, 1024)
  driver().grant(3068)
  await writing
  assert.equal(levels.length, 1)
  assert.ok(Math.abs(levels[0] - (13107 / 32768) * 0.25) < 1e-12)
  assert.ok(driver().writes.every((part) => part.every((value) => value === 51)))
  out.close()
})

test('levels aggregate short decoder writes into full blocks and one partial drain tail', async () => {
  const driver = fixture()
  const levels = [],
    out = openOutput(16000, 0.25, 4092, (level) => levels.push(level))
  const pcm = new Int16Array(384).fill(16384)
  for (let i = 0; i < 5; i++) await out.write(new Uint8Array(pcm.buffer))
  assert.deepEqual(levels, [])
  await out.write(new Uint8Array(pcm.buffer))
  assert.deepEqual(levels, [0.125])
  assert.equal(out.frames, 2304)
  await out.drain()
  assert.deepEqual(levels, [0.125, 0.125])
  assert.equal(out.frames, 2304)
  assert.equal(driver().writes.length, 9)
  out.close()
})

test('block level preserves existing mean absolute amplitude semantics', async () => {
  fixture()
  const levels = [],
    out = openOutput(16000, 0.25, 4092, (level) => levels.push(level))
  const pcm = new Int16Array(2046)
  for (let i = 0; i < pcm.length; i += 2) pcm[i] = -16384
  await out.write(new Uint8Array(pcm.buffer))
  assert.equal(levels.length, 1)
  assert.ok(Math.abs(levels[0] - 0.5 * 0.125) < 1e-12)
  out.close()
})

test('close while a block waits for credit emits no late level notification', async () => {
  const driver = fixture({ credit: 0, refill: false })
  const levels = [],
    out = openOutput(16000, 0.25, 4092, (level) => levels.push(level))
  const writing = out.write(new Uint8Array(4092))
  out.close()
  await assert.rejects(writing, { code: 'cancelled' })
  driver().grant(4092)
  await tick()
  assert.deepEqual(levels, [])
})

test('diagnostics distinguish supply gaps, DMA credit waits and intentional drain silence', async () => {
  const driver = fixture({ credit: 4092, refill: false })
  let now = 0
  const reports = []
  const out = openOutput(16000, 0.25, 4092, undefined, { now: () => now, emit: (v) => reports.push(v) })
  await tick()
  now = 10
  await out.write(new Uint8Array(4092).fill(1))
  now = 70
  const second = out.write(new Uint8Array(4092).fill(2))
  await tick()
  now = 95
  driver().grant(4092 * 5)
  await second
  now = 100
  const draining = out.drain()
  await tick()
  assert.deepEqual(reports, [[1, 8184, 8184, 10, 10, 100, 60, 85, 25, 25, 1, 20460, 0]])
  assert.ok(driver().writes.length > 2, 'intentional flush silence is excluded from nativeBytes')
  out.close()
  await assert.rejects(draining, { code: 'cancelled' })
  assert.equal(reports.length, 1)
})

test('diagnostics report an aborted credit wait and staged tail without claiming it played', async () => {
  fixture({ credit: 0, refill: false })
  let now = 0
  const reports = []
  const out = openOutput(16000, 0.25, 4092, undefined, { now: () => now, emit: (v) => reports.push(v) })
  now = 20
  const writing = out.write(new Uint8Array(4092))
  await tick()
  now = 120
  out.close()
  await assert.rejects(writing, { code: 'cancelled' })
  assert.deepEqual(reports, [[2, 4092, 0, 20, 0, 120, 0, 0, 100, 100, 0, 0, 4092]])
  out.close()
  assert.equal(reports.length, 1)
})

test('diagnostic observer failure does not change accepted PCM or drain', async () => {
  const driver = fixture()
  const out = openOutput(16000, 0.25, 4092, undefined, {
    now: () => 0,
    emit: () => {
      throw Error('observer failed')
    },
  })
  await out.write(new Uint8Array([1, 2]))
  await out.drain()
  assert.deepEqual(driver().writes[0], new Uint8Array([1, 2]))
  out.close()
})

test('supply model accounts for all queued PCM, not just wide write intervals', async () => {
  fixture()
  let now = 1000
  const summaries = []
  const out = openOutput(16000, 0, 4092, undefined, {
    now: () => now,
    emit() {},
    emitSupply(values) {
      summaries.push(values)
    },
  })
  await tick()
  await out.write(new Uint8Array(4092))
  await out.write(new Uint8Array(4092))
  now += 200
  await out.write(new Uint8Array(4092))
  now += 255
  await out.write(new Uint8Array(4092))
  await out.drain()
  out.close()
  // Three descriptors contain 383.625 ms; the fourth arrives 455 ms after start.
  assert.deepEqual(summaries, [[1, 4, 1, 71, 71, 0, 16368]])
})

function startupFixture() {
  const timers = new Map()
  let next = 0
  return {
    timers,
    options: {
      setTimer(callback, ms) {
        timers.set(++next, { callback, ms })
        return next
      },
      clearTimer(id) {
        timers.delete(id)
      },
    },
    fire() {
      for (const [id, job] of [...timers]) {
        timers.delete(id)
        job.callback()
      }
    },
  }
}

test('startup reuses one 12276-byte stage, then writes 4092-byte chunks and seven silence blocks', async () => {
  const driver = fixture(),
    start = startupFixture()
  const out = openOutput(16000, 0, 17920, undefined, undefined, start.options)
  const expected = []
  for (let i = 1; i <= 2; i++) {
    const pcm = new Uint8Array(4092).fill(i)
    expected.push(...pcm)
    await out.write(pcm)
    pcm.fill(255)
  }
  assert.equal(driver().writes.length, 0)
  assert.equal([...start.timers.values()][0].ms, 500)
  const pcm = new Uint8Array(4092).fill(3)
  expected.push(...pcm)
  await out.write(pcm)
  assert.equal(driver().writes.length, 3)
  assert.equal(start.timers.size, 0)
  await out.write(new Uint8Array(4092).fill(4))
  expected.push(...new Uint8Array(4092).fill(4))
  assert.equal(driver().writes.length, 4)
  await out.drain()
  assert.deepEqual(
    driver()
      .writes.slice(0, 4)
      .flatMap((bytes) => [...bytes]),
    expected,
  )
  assert.deepEqual(
    driver()
      .writes.slice(4)
      .map((bytes) => bytes.length),
    Array(7).fill(4092),
  )
  assert.ok(
    driver()
      .writes.slice(4)
      .every((bytes) => bytes.every((value) => value === 0)),
  )
  out.close()
})

test('startup short audio drains immediately and close discards partial audio', async () => {
  for (const close of [false, true]) {
    const driver = fixture(),
      start = startupFixture()
    const out = openOutput(16000, 0, 17920, undefined, undefined, start.options)
    await out.write(new Uint8Array(1234).fill(7))
    assert.equal(driver().writes.length, 0)
    if (close) out.close()
    else await out.drain()
    start.fire()
    await tick()
    assert.equal(start.timers.size, 0)
    assert.equal(driver().writes.length, close ? 0 : 8)
    if (!close) assert.equal(driver().writes[0].length, 1234)
    out.close()
  }
})

test('startup timer flush serializes writes, protects data while waiting and never re-arms', async () => {
  const driver = fixture({ credit: 0, refill: false }),
    start = startupFixture()
  const out = openOutput(16000, 0, 17920, undefined, undefined, start.options)
  await out.write(new Uint8Array(4092).fill(1))
  start.fire()
  const writing = out.write(new Uint8Array(4092).fill(2))
  await assert.rejects(out.write(new Uint8Array(2)), RangeError)
  await assert.rejects(out.drain(), /write still pending/)
  driver().grant(8184)
  await writing
  assert.deepEqual(
    driver().writes.map((bytes) => bytes[0]),
    [1, 2],
  )
  assert.equal(start.timers.size, 0)
  out.close()
})

test('startup cancel while flushing rejects held writer and dispatches no remaining blocks', async () => {
  const driver = fixture({ credit: 4092, refill: false }),
    start = startupFixture()
  const out = openOutput(16000, 0, 17920, undefined, undefined, start.options)
  const writing = out.write(new Uint8Array(12276))
  await tick()
  assert.equal(driver().writes.length, 1)
  out.close()
  await assert.rejects(writing, { code: 'cancelled' })
  assert.equal(driver().writes.length, 1)
  assert.equal(start.timers.size, 0)
})

test('startup timer failure is retained for write/drain without unhandled rejection', async () => {
  const driver = fixture(),
    start = startupFixture()
  const out = openOutput(16000, 0, 17920, undefined, undefined, start.options)
  await out.write(new Uint8Array(4092))
  driver().write = () => {
    throw Error('fixture failure')
  }
  start.fire()
  await tick()
  await assert.rejects(out.write(new Uint8Array(2)), /fixture failure/)
  await assert.rejects(out.drain(), /fixture failure/)
  out.close()
})

test('combined 24k adapter and startup sink allocate only 16368 PCM bytes and preserve resampling', async () => {
  const { createResampledOutput } = await import('../setup-device/resampled-output.js')
  const { default: resample } = await import('../../testing/fakes/pcm-resampler.ts')
  async function render(blocks) {
    const driver = fixture(),
      start = startupFixture()
    const adapter = createResampledOutput({
      minimumOutputBytes: 4092,
      resample,
      openOutput: (rate, volume, limit, level, reserve) =>
        openOutput(rate, volume, limit, level, undefined, reserve === 3 ? start.options : undefined),
    })
    const allocations = []
    const Original = globalThis.Uint8Array
    let out
    try {
      globalThis.Uint8Array = class extends Original {
        constructor(...args) {
          super(...args)
          if (typeof args[0] === 'number') allocations.push(args[0])
        }
      }
      out = adapter.openOutput(24000, 0, 17920, undefined, blocks)
    } finally {
      globalThis.Uint8Array = Original
    }
    assert.equal(
      allocations.reduce((a, b) => a + b, 0),
      blocks === 3 ? 16368 : 8184,
    )
    const pcm = Int16Array.from({ length: 14001 }, (_, i) => i - 7000)
    for (let at = 0; at < pcm.length; at += 997)
      await out.write(new Uint8Array(pcm.buffer, at * 2, Math.min(997, pcm.length - at) * 2))
    await out.drain()
    const result = driver()
      .writes.slice(0, -7)
      .flatMap((bytes) => [...bytes])
    out.close()
    return result
  }
  assert.deepEqual(await render(3), await render(1))
})
