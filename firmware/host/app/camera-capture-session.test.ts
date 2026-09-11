import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installRuntimeTestAliases } from './__tests__/runtime-test-aliases.js'
import type { CameraPort, CaptureFrame } from './camera-capture-session.js'

installRuntimeTestAliases()
const { CameraCaptureSession } = await import('./camera-capture-session.js')
const { CancellationSource } = await import('./cancellation.js')

class Clock {
  jobs = new Set<{ ms: number; callback: () => void }>()
  after(ms: number, callback: () => void): () => void {
    const job = { ms, callback }
    this.jobs.add(job)
    return () => {
      this.jobs.delete(job)
    }
  }
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
function fixture() {
  const clock = new Clock()
  const calls: string[] = []
  const frame: CaptureFrame = {
    width: 2,
    height: 1,
    format: 'rgb565le',
    source: 'native',
    data: new Uint8Array([1, 2, 3, 4]).buffer,
    close() {
      calls.push('release')
    },
  }
  const port: CameraPort = {
    info: { availability: 'native', formats: ['rgb565le'] },
    start() {
      calls.push('start')
    },
    async capture() {
      calls.push('capture')
      return frame
    },
    stop() {
      calls.push('stop')
    },
  }
  return { clock, calls, frame, port }
}
test('capture returns an owned copy only after native release and stop, for 100 lifetimes', async () => {
  const f = fixture()
  for (let cycle = 0; cycle < 100; cycle++) {
    const camera = new CameraCaptureSession(f.port, f.clock)
    const image = await camera.capture()
    assert.notEqual(image.data, f.frame.data)
    assert.deepEqual(new Uint8Array(image.data), new Uint8Array(f.frame.data))
    assert.equal(image.source, 'native')
    assert.deepEqual(f.calls.splice(0), ['start', 'capture', 'release', 'stop'])
    const closed = camera.close()
    assert.equal(closed, camera.close())
    await closed
    assert.equal(f.clock.jobs.size, 0)
    await assert.rejects(camera.capture(), { code: 'CLOSED' })
  }
})
test('invalid options and unavailable formats never start the port', async () => {
  const f = fixture(),
    camera = new CameraCaptureSession(f.port, f.clock)
  for (const width of [0, -1, NaN, Infinity, 1.5, 321])
    await assert.rejects(camera.capture({ width }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(camera.capture({ format: 'jpeg' }), { code: 'UNSUPPORTED' })
  Object.defineProperty(f.port, 'info', { value: { availability: 'unavailable', formats: [] } })
  await assert.rejects(camera.capture(), { code: 'UNSUPPORTED' })
  assert.deepEqual(f.calls, [])
  await camera.close()
})
test('missing and malformed frames fail while native frames and camera still close', async () => {
  const f = fixture(),
    camera = new CameraCaptureSession(f.port, f.clock)
  f.frame.data = new ArrayBuffer(3)
  await assert.rejects(camera.capture(), { code: 'IO' })
  assert.deepEqual(f.calls.splice(0), ['start', 'capture', 'release', 'stop'])
  f.port.capture = async () => undefined
  await assert.rejects(camera.capture(), { code: 'IO' })
  assert.deepEqual(f.calls, ['start', 'stop'])
  await camera.close()
})
test('failed start rolls back and failed release faults future captures', async () => {
  const f = fixture(),
    camera = new CameraCaptureSession(f.port, f.clock)
  f.port.start = () => {
    throw new Error('start failed')
  }
  await assert.rejects(camera.capture(), { code: 'IO', message: 'start failed' })
  assert.deepEqual(f.calls.splice(0), ['stop'])
  f.port.start = () => {
    f.calls.push('start')
  }
  f.frame.close = () => {
    throw new Error('release failed')
  }
  await assert.rejects(camera.capture(), { code: 'IO', message: 'release failed' })
  await assert.rejects(camera.capture(), { code: 'IO', message: 'release failed' })
  assert.deepEqual(f.calls, ['start', 'capture', 'stop'])
  await assert.rejects(camera.close(), { code: 'IO', message: 'release failed' })
})
test('cancellation waits for stop and a late frame cannot stop the next capture', async () => {
  const f = fixture(),
    camera = new CameraCaptureSession(f.port, f.clock)
  const source = new CancellationSource()
  let finishOld: (frame: CaptureFrame) => void, finishStop: () => void
  f.port.capture = () =>
    new Promise((resolve) => {
      finishOld = resolve
    })
  f.port.stop = () => {
    f.calls.push('stop')
    return new Promise((resolve) => {
      finishStop = resolve
    })
  }
  const old = camera.capture({ signal: source.signal })
  const rejected = assert.rejects(old, { code: 'CANCELLED' })
  await flush()
  source.cancel()
  await flush()
  const next = camera.capture()
  assert.deepEqual(f.calls, ['start', 'stop'])
  f.port.capture = async () => f.frame
  f.port.stop = () => {
    f.calls.push('stop')
  }
  finishStop()
  await rejected
  await next
  finishOld(f.frame)
  await flush()
  assert.deepEqual(f.calls, ['start', 'stop', 'start', 'release', 'stop', 'release'])
  assert.equal(f.clock.jobs.size, 0)
  await camera.close()
})
test('close during start prevents capture even after start resolves', async () => {
  const f = fixture(),
    camera = new CameraCaptureSession(f.port, f.clock)
  let start: () => void
  f.port.start = () =>
    new Promise((resolve) => {
      start = resolve
    })
  const pending = camera.capture()
  const rejected = assert.rejects(pending, { code: 'CLOSED' })
  await camera.close()
  start()
  await rejected
  await flush()
  assert.deepEqual(f.calls, ['stop'])
  assert.equal(f.clock.jobs.size, 0)
})
test('stop failure prevents queued or future use and stays observable from close', async () => {
  const f = fixture(),
    camera = new CameraCaptureSession(f.port, f.clock)
  f.port.stop = () => {
    throw new Error('stop failed')
  }
  const first = camera.capture(),
    second = camera.capture()
  await assert.rejects(first, { code: 'IO', message: 'stop failed' })
  await assert.rejects(second, { code: 'IO', message: 'stop failed' })
  assert.deepEqual(f.calls, ['start', 'capture', 'release'])
  await assert.rejects(camera.close(), { code: 'IO', message: 'stop failed' })
  assert.equal(f.clock.jobs.size, 0)
})
