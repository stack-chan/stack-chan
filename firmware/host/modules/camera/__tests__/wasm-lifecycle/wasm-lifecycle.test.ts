import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import Camera from 'wasm-camera'

type Frame = { width: number; height: number; imageType: string; buffer: ArrayBuffer; close?(): void }
type Bridge = {
  start(width: number, height: number, browser: boolean): void | Promise<void>
  stop(): void | Promise<void>
  capture(width: number, height: number): Frame | undefined
  startStatus?(): number
  availability?(): number
  error?(): string
}
const env = globalThis as unknown as { __stackchanWasmCameraBridge?: Bridge; Host?: { Camera?: unknown } }
const sleep = (ms: number) => new Promise<void>((resolve) => Timer.set(() => resolve(), ms))
async function rejected(promise: Promise<unknown>, code: string) {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  equal((caught as { code?: string })?.code, code, 'operation error')
}
function fixture() {
  const calls: string[] = []
  let status = 1,
    ready = true
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer
  const bridge: Bridge = {
    start(_w, _h, browser) {
      calls.push(browser ? 'native' : 'simulated')
    },
    startStatus: () => status,
    stop() {
      calls.push('stop')
    },
    capture(width, height) {
      calls.push('capture')
      return ready
        ? {
            width,
            height,
            imageType: 'rgb565le',
            buffer: bytes,
            close() {
              calls.push('release')
            },
          }
        : undefined
    },
  }
  env.__stackchanWasmCameraBridge = bridge
  return {
    bridge,
    calls,
    bytes,
    setStatus(value: number) {
      status = value
    },
    setReady(value: boolean) {
      ready = value
    },
  }
}

async function run() {
  delete env.__stackchanWasmCameraBridge
  if (env.Host) delete env.Host.Camera
  const missing = new Camera()
  equal(missing.availability, 'unavailable')
  await rejected(missing.capture(), 'UNSUPPORTED')
  await missing.close()

  for (let cycle = 0; cycle < 100; cycle++) {
    const f = fixture(),
      camera = new Camera({ useBrowserCamera: false })
    equal(camera.availability, 'simulated')
    const frame = await camera.capture({ width: 2, height: 1, imageType: 'rgb565be' })
    assert(frame.buffer !== f.bytes, 'image is copied')
    equal(new Uint8Array(frame.buffer).join(','), '2,1,4,3', 'endianness')
    equal(frame.source, 'simulated')
    const closing = camera.close()
    equal(closing, camera.close())
    await closing
    await camera.stop()
    equal(f.calls.join(','), 'simulated,capture,release,stop', 'owned cleanup occurs once')
    await rejected(camera.capture(), 'CLOSED')
  }

  let f = fixture()
  const old = new Camera(),
    other = new Camera()
  await old.start()
  await rejected(other.start(), 'BUSY')
  await other.close()
  equal(f.calls.join(','), 'native', 'closing a non-owner cannot stop the owner')
  await old.stop()
  const next = new Camera()
  await next.start()
  await old.close()
  equal(f.calls.join(','), 'native,stop,native', 'old close cannot stop the new owner')
  await next.close()

  f = fixture()
  f.setStatus(0)
  const pendingCamera = new Camera()
  const pending = rejected(pendingCamera.start(), 'CLOSED')
  await pendingCamera.close()
  f.setStatus(1)
  await pending
  await sleep(40)
  equal(f.calls.join(','), 'native,stop', 'cancelled polls cannot revive camera')

  f = fixture()
  f.setStatus(-1)
  const denied = new Camera()
  await rejected(denied.start(), 'IO')
  equal(f.calls.join(','), 'native,stop', 'failed start is rolled back')
  await denied.close()

  f = fixture()
  const warming = new Camera()
  await warming.start()
  f.setReady(false)
  const image = warming.capture({ width: 2, height: 1 })
  Timer.set(() => f.setReady(true), 30)
  await image
  f.setReady(false)
  await rejected(warming.capture({ width: 2, height: 1 }), 'TIMEOUT')
  const cancelled = rejected(warming.capture({ width: 2, height: 1 }), 'CLOSED')
  await warming.close()
  await cancelled
  const reads = f.calls.length
  f.setReady(true)
  await sleep(40)
  equal(f.calls.length, reads, 'closed capture has no active polls')

  f = fixture()
  const malformed = new Camera()
  await rejected(malformed.capture({ width: 3, height: 2 }), 'IO')
  assert(f.calls.includes('release'), 'invalid frame is released')
  await rejected(malformed.capture({ imageType: 'jpeg' }), 'UNSUPPORTED')
  await rejected(malformed.capture({ width: 0 }), 'INVALID_ARGUMENT')
  await malformed.close()

  f = fixture()
  const pinned = new Camera()
  const replacement = fixture()
  await pinned.start()
  await pinned.close()
  equal(f.calls.join(','), 'native,stop')
  equal(replacement.calls.length, 0, 'close uses the acquired bridge')

  f = fixture()
  let stops = 0
  f.bridge.stop = () => {
    stops++
    throw new Error('stop failed')
  }
  const broken = new Camera()
  await broken.start()
  await rejected(broken.close(), 'IO')
  await rejected(broken.close(), 'IO')
  await rejected(new Camera().start(), 'IO')
  equal(stops, 1, 'stop failure is retained without reopening')
  trace('ok\n')
}
run().catch((error) => {
  trace(`WASM camera lifecycle failed: ${String(error)}\n`)
  throw error
})
