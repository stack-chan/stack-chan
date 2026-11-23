import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const source = (await readFile(new URL('./output.js', import.meta.url), 'utf8')).replace(
  "import { pcmLevel } from 'stackchan/voice/levels'", `const pcmLevel = bytes => { const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2); let sum = 0; for (const sample of samples) sum += Math.abs(sample); return sum / (samples.length * 32768) }`)
const { openOutput } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture({ credit = 4092 * 5, refill = true } = {}) {
  let driver
  globalThis.device = { audio: { Output: class {
    constructor(options) { this.options = options; this.credit = credit; this.writes = []; this.closes = 0; driver = this }
    start() { queueMicrotask(() => this.options.onWritable(this.credit)) }
    write(bytes) {
      assert.ok(bytes.length <= this.credit)
      this.credit -= bytes.length
      this.writes.push(Uint8Array.from(bytes))
      if (refill) queueMicrotask(() => this.grant(bytes.length))
    }
    grant(bytes) { this.credit += bytes; this.options.onWritable(this.credit) }
    close() { this.closes++ }
  } } }
  return () => driver
}

test('initial five DMA credits prefill at volume .25 without a hardware completion', async () => {
  const driver = fixture({ refill: false })
  const out = openOutput(16000, .25, 6400)
  let finished = 0
  const run = (async () => { for (let i = 0; i < 6; i++) { await out.write(new Uint8Array(4092).fill(i)); finished++ } })()
  await tick()
  assert.equal(driver().volume, .25)
  assert.equal(driver().writes.length, 5)
  assert.equal(finished, 5)
  driver().grant(4092)
  await run
  assert.equal(finished, 6)
  assert.deepEqual(driver().writes.map(bytes => bytes[0]), [0,1,2,3,4,5])
  out.close()
})

test('drain flushes copied partial PCM then seven descriptors of silence', async () => {
  const driver = fixture()
  const out = openOutput(16000, .25, 6400)
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
  assert.deepEqual(writes.slice(2).map(bytes => bytes.length), Array(7).fill(4092))
  assert.ok(writes.slice(2).every(bytes => bytes.every(value => value === 0)))
  assert.equal(out.frames, expected.length / 2)
  out.close(); out.close()
  assert.equal(driver().closes, 1)
})

test('no credit blocks a full stage and rejects overlapping write/drain', async () => {
  const driver = fixture({ credit: 0, refill: false })
  const out = openOutput(16000, .25, 4092)
  let accepted = 0, settled = false
  const writing = out.write(new Uint8Array(4092), count => { accepted += count }).then(() => { settled = true })
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
  const out = openOutput(16000, .25, 4092)
  const writing = out.write(new Uint8Array(4092))
  out.close()
  await assert.rejects(writing, { code: 'cancelled' })
  driver().grant(4092)
  await tick()
  assert.equal(driver().writes.length, 0)
})

test('close discards a partial stage and rejects later drain/write', async () => {
  const driver = fixture()
  const out = openOutput(16000, .25, 4092)
  await out.write(new Uint8Array(768))
  out.close()
  await assert.rejects(out.drain(), { code: 'cancelled' })
  await assert.rejects(out.write(new Uint8Array(2)), { code: 'cancelled' })
  assert.equal(driver().writes.length, 0)
})

test('drain shares its pending promise and close releases its credit wait', async () => {
  const driver = fixture({ credit: 4092, refill: false })
  const out = openOutput(16000, .25, 4092)
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
  const levels = [], out = openOutput(16000, .25, 4092, level => levels.push(level))
  const bytes = new Uint8Array(4092).fill(51)
  const writing = out.write(bytes, () => bytes.fill(255))
  await tick()
  assert.deepEqual(levels, [])
  assert.equal(driver().writes[0].length, 1024)
  driver().grant(3068)
  await writing
  assert.equal(levels.length, 1)
  assert.ok(Math.abs(levels[0] - (13107 / 32768 * .25)) < 1e-12)
  assert.ok(driver().writes.every(part => part.every(value => value === 51)))
  out.close()
})

test('levels aggregate short decoder writes into full blocks and one partial drain tail', async () => {
  const driver = fixture()
  const levels = [], out = openOutput(16000, .25, 4092, level => levels.push(level))
  const pcm = new Int16Array(384).fill(16384)
  for (let i = 0; i < 5; i++) await out.write(new Uint8Array(pcm.buffer))
  assert.deepEqual(levels, [])
  await out.write(new Uint8Array(pcm.buffer))
  assert.deepEqual(levels, [.125])
  assert.equal(out.frames, 2304)
  await out.drain()
  assert.deepEqual(levels, [.125, .125])
  assert.equal(out.frames, 2304)
  assert.equal(driver().writes.length, 9)
  out.close()
})

test('block level preserves existing mean absolute amplitude semantics', async () => {
  fixture()
  const levels = [], out = openOutput(16000, .25, 4092, level => levels.push(level))
  const pcm = new Int16Array(2046)
  for (let i = 0; i < pcm.length; i += 2) pcm[i] = -16384
  await out.write(new Uint8Array(pcm.buffer))
  assert.equal(levels.length, 1)
  assert.ok(Math.abs(levels[0] - .5 * .125) < 1e-12)
  out.close()
})

test('close while a block waits for credit emits no late level notification', async () => {
  const driver = fixture({ credit: 0, refill: false })
  const levels = [], out = openOutput(16000, .25, 4092, level => levels.push(level))
  const writing = out.write(new Uint8Array(4092))
  out.close()
  await assert.rejects(writing, { code: 'cancelled' })
  driver().grant(4092)
  await tick()
  assert.deepEqual(levels, [])
})
