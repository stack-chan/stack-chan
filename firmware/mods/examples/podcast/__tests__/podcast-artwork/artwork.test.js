import Resource from 'Resource'
import Bitmap from 'commodetto/Bitmap'
import BufferOut from 'commodetto/BufferOut'
import Poco from 'commodetto/Poco'
import { loadArtwork } from 'podcast-artwork'
import { ArtworkRing, RING_BYTES } from 'podcast-artwork-ring'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import Worker from 'worker'

async function decode(bytes, cancel = false) {
  const data = new SharedArrayBuffer(RING_BYTES),
    state = new SharedArrayBuffer(16)
  const pixels = new SharedArrayBuffer(64 * 64 * 2)
  const ring = new ArtworkRing(data, state)
  const worker = new Worker('podcast-artwork-decode-worker')
  let timer,
    offset = 0
  const result = new Promise((resolve) => {
    worker.onmessage = (message) => {
      Timer.clear(timer)
      worker.terminate()
      resolve(message)
    }
  })
  worker.postMessage({ data, state, pixels })
  timer = Timer.repeat(() => {
    if (cancel) {
      ring.cancel()
      return
    }
    const target = ring.target(Math.min(100, bytes.length - offset))
    target.set(bytes.subarray(offset, offset + target.length))
    offset += target.length
    ring.commit(target.length)
    if (offset === bytes.length) ring.end()
  }, 1)
  return { ...(await result), pixels }
}

const bytes = new Uint8Array(new Resource('fixture.jpg'))
const result = await decode(bytes)
assert(!result.error, result.error)
equal(result.decode.width, 1400)
equal(result.decode.height, 700)
const bigEndian = result.decode.pixelFormat === Bitmap.RGB565BE
const samples = new DataView(result.pixels)
const sample = (x, y) => samples.getUint16((y * 64 + x) * 2, !bigEndian)
equal(samples.byteLength, 8192)
equal(sample(0, 0), 0, 'letterbox remains blank')
assert((sample(10, 32) & 0xf800) > 0xf000, 'left half is red after streamed C downsample')
assert((sample(50, 32) & 0x001f) > 28, 'right half is blue')
equal(result.decode.bytes, bytes.length, 'consumer drains to HTTP EOF')
export const thumbnail = new Bitmap(64, 64, result.decode.pixelFormat, result.pixels, 0)
// Check pixels produced by the actual renderer, including byte order, rather than just Bitmap metadata.
const output = new BufferOut({ width: 64, height: 64, pixelFormat: screen.pixelFormat })
const poco = new Poco(output)
poco.begin()
poco.fillRectangle(poco.makeColor(0, 255, 0), 0, 0, 64, 64)
poco.drawBitmap(thumbnail, 0, 0)
poco.end()
const rendered = new DataView(output.buffer)
assert((rendered.getUint16((32 * 64 + 10) * 2, !bigEndian) & 0xf800) > 0xf000, 'rendered left half is red')
assert((rendered.getUint16((32 * 64 + 50) * 2, !bigEndian) & 0x001f) > 28, 'rendered right half is blue')
poco.close()
assert((await decode(bytes.subarray(0, bytes.length - 10))).error, 'truncated JPEG is rejected')
assert((await decode(bytes, true)).error, 'cancellation unblocks native input')
const bad = bytes.slice()
for (let i = 0; i < bad.length - 1; i++) {
  if (bad[i] === 255 && bad[i + 1] === 192) {
    bad[i + 1] = 194
    break
  }
}
assert((await decode(bad)).error, 'progressive JPEG is rejected')

// The orchestrator must not delete a native decoding task before its cancellation reply.
const workers = []
class FakeWorker {
  constructor(name) {
    this.name = name
    workers.push(this)
  }
  postMessage(message) {
    this.message = message
  }
  terminate() {
    this.terminated = true
  }
}
const turn = () => new Promise((resolve) => Timer.set(resolve))
const until = (condition) =>
  new Promise((resolve, reject) => {
    const deadline = Timer.set(() => {
      Timer.clear(timer)
      reject(new Error('Worker start timed out'))
    }, 1000)
    const timer = Timer.repeat(() => {
      if (condition()) {
        Timer.clear(timer)
        Timer.clear(deadline)
        resolve()
      }
    }, 1)
  })
const load = loadArtwork('https://example.test/art.jpg', FakeWorker)
await until(() => workers.length === 2)
const rejected = load.promise.then(
  () => false,
  () => true,
)
load.cancel()
assert(await rejected)
assert(!workers[0].terminated, 'native HTTP must finish before terminating its task')
assert(!workers[1].terminated, 'decoder must finish its native call')
equal(Atomics.load(new Int32Array(workers[1].message.state), 3), 1)
const replacement = loadArtwork('https://example.test/new.jpg', FakeWorker)
await turn()
equal(workers.length, 2, 'replacement waits until both native tasks have finished')
workers[0].onmessage({ error: 'cancelled' })
assert(workers[0].terminated, 'HTTP reply marks a safe point for deleting the producer')
workers[1].onmessage({ error: 'cancelled' })
assert(workers[1].terminated, 'reply marks a safe point for deleting the decoder')
await until(() => workers.length === 4)
const download = workers[2],
  decoder = workers[3]
decoder.onmessage({ decode: { width: 3000, height: 3000, pixelFormat: screen.pixelFormat } })
let resolved = false
replacement.promise.then(() => {
  resolved = true
})
await Promise.resolve()
assert(!resolved, 'decode alone is not a complete HTTP download')
download.onmessage({ download: { bytes: 1140416 } })
const loaded = await replacement.promise
equal(loaded.width, 64)
equal(loaded.pixelFormat, screen.pixelFormat, 'orchestrator preserves the decoder/display byte order')
assert(download.terminated && decoder.terminated)
