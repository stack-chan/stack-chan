import assert from 'node:assert/strict'
import { test } from 'node:test'
import Microphone from '../../modules/audio/wasm/microphone.js'
import Tone from '../../modules/audio/wasm/tone.js'
import FallbackCamera from '../../modules/camera/lin/camera.js'
import Camera from '../../modules/camera/wasm/camera.js'
import {
  DynamixelDriver,
  M5StackChanServoDriver,
  NoneDriver,
  PWMServoDriver,
  RS30XDriver,
  SCServoDriver,
  WasmDriver,
} from '../../modules/motion/wasm/wasm-driver.js'

type Rotation = { y: number; p: number; r: number }
type MotionCompletion = (error?: unknown) => void
type MotionResultCallback<T> = (result: T) => void
type DriverConstructor = new (
  options?: unknown,
) => {
  applyRotation(rotation: Rotation, time?: number, callback?: MotionCompletion): void
  getRotation(callback: MotionResultCallback<unknown>): void
  setTorque(torque: boolean, callback?: MotionCompletion): void
}

type HostCameraTestBridge = {
  start?: (options?: unknown) => void
  stop?: () => void
  capture?: (options?: unknown) => unknown
}

type WasmCameraTestBridge = {
  start?: (width: number, height: number, useBrowserCamera: boolean) => void
  stop?: () => void
  capture?: (width: number, height: number) => unknown
}

const setHostCamera = (CameraBridge: HostCameraTestBridge | undefined): typeof globalThis.Host => {
  const previousHost = globalThis.Host
  const nextHost = { ...(previousHost ?? {}) } as typeof globalThis.Host & { Camera?: HostCameraTestBridge }

  if (CameraBridge) {
    nextHost.Camera = CameraBridge
  } else {
    delete nextHost.Camera
  }

  globalThis.Host = nextHost
  return previousHost
}

const setWasmCameraBridge = (CameraBridge: WasmCameraTestBridge | undefined): WasmCameraTestBridge | undefined => {
  const env = globalThis as typeof globalThis & { __stackchanWasmCameraBridge?: WasmCameraTestBridge }
  const previous = env.__stackchanWasmCameraBridge

  if (CameraBridge) {
    env.__stackchanWasmCameraBridge = CameraBridge
  } else {
    delete env.__stackchanWasmCameraBridge
  }

  return previous
}

const driverCases: Array<[string, DriverConstructor]> = [
  ['dynamixel', DynamixelDriver],
  ['m5stackchan', M5StackChanServoDriver],
  ['none', NoneDriver],
  ['pwm', PWMServoDriver],
  ['rs30x', RS30XDriver],
  ['scservo', SCServoDriver],
]

function readDriverRotation(driver: InstanceType<DriverConstructor>): unknown {
  let result: unknown
  driver.getRotation((value) => {
    result = value
  })
  return result
}

function runDriverCommand(start: (callback: MotionCompletion) => void): unknown {
  let callbackError: unknown
  start((error) => {
    callbackError = error
  })
  return callbackError
}

for (const [name, Driver] of driverCases) {
  test(`${name} WASM driver alias uses the consolidated WasmDriver bridge`, () => {
    assert.equal(Driver, WasmDriver)

    const result = readDriverRotation(new Driver())

    assert.deepEqual(result, { success: true, value: { y: 0, p: 0, r: 0 } })
  })
}

test('WasmDriver applyRotation pushes pose changes to the browser Host.Driver bridge', () => {
  const calls: unknown[] = []
  const previousHost = globalThis.Host
  globalThis.Host = {
    Driver: {
      applyRotation(message: unknown) {
        calls.push(message)
      },
    },
  }

  try {
    const driver = new WasmDriver()
    const rotation = { y: 0.25, p: -0.125, r: 0.05 }

    const error = runDriverCommand((callback) => driver.applyRotation(rotation, 0.75, callback))

    assert.equal(error, undefined)
    assert.deepEqual(calls, [{ rotation, time: 0.75 }])
    assert.deepEqual(readDriverRotation(driver), { success: true, value: rotation })
  } finally {
    globalThis.Host = previousHost
  }
})

test('WasmDriver applyRotation rejects invalid rotation payloads without mutating state or calling the host bridge', () => {
  const calls: unknown[] = []
  const previousHost = globalThis.Host
  globalThis.Host = {
    Driver: {
      applyRotation(message: unknown) {
        calls.push(message)
      },
    },
  }

  try {
    const driver = new WasmDriver()
    const validRotation = { y: 0.25, p: -0.125, r: 0.05 }
    assert.equal(
      runDriverCommand((callback) => driver.applyRotation(validRotation, undefined, callback)),
      undefined,
    )

    const error = runDriverCommand((callback) =>
      driver.applyRotation({ y: Number.NaN, p: 0, r: 0 } as Rotation, undefined, callback),
    )

    assert.ok(error instanceof TypeError)
    assert.deepEqual(calls, [{ rotation: validRotation, time: undefined }])
    assert.deepEqual(readDriverRotation(driver), {
      success: true,
      value: validRotation,
    })
  } finally {
    globalThis.Host = previousHost
  }
})

test('WasmDriver setTorque forwards torque state to the browser Host.Driver bridge when present', () => {
  const calls: unknown[] = []
  const previousHost = globalThis.Host
  globalThis.Host = {
    Driver: {
      setTorque(torque: unknown) {
        calls.push(torque)
      },
    },
  }

  try {
    const error = runDriverCommand((callback) => new WasmDriver().setTorque(true, callback))

    assert.equal(error, undefined)
    assert.deepEqual(calls, [true])
  } finally {
    globalThis.Host = previousHost
  }
})

test('WASM microphone records through the browser Host.AudioIn bridge when present', async () => {
  const previousHost = globalThis.Host
  const recordedDurations: number[] = []
  const expected = new Uint8Array([1, 2, 3, 4]).buffer
  globalThis.Host = {
    AudioIn: {
      async record(durationMilliSec: number) {
        recordedDurations.push(durationMilliSec)
        return expected
      },
    },
  }

  try {
    const result = await new Microphone().record(1000)

    assert.equal(result, expected)
    assert.deepEqual(recordedDurations, [1000])
  } finally {
    globalThis.Host = previousHost
  }
})

test('WASM microphone falls back to an empty buffer when Host.AudioIn is unavailable', async () => {
  const microphone = new Microphone()

  const result = await microphone.record(1000)

  assert.ok(result instanceof ArrayBuffer)
  assert.equal(result.byteLength, 0)
})

test('WASM microphone rejects browser Host.AudioIn bridge errors', async () => {
  const previousHost = globalThis.Host
  globalThis.Host = {
    AudioIn: {
      async record() {
        throw new Error('permission denied')
      },
    },
  }

  try {
    await assert.rejects(() => new Microphone().record(1000), /permission denied/)
  } finally {
    globalThis.Host = previousHost
  }
})

test('WASM synthetic camera captures deterministic RGB565LE frames', async () => {
  const camera = new Camera()

  const first = await camera.capture({ width: 4, height: 3, imageType: 'rgb565le' })
  const second = await camera.capture({ width: 4, height: 3, imageType: 'rgb565le' })

  assert.ok(first)
  assert.ok(second)
  assert.equal(first.width, 4)
  assert.equal(first.height, 3)
  assert.equal(first.imageType, 'rgb565le')
  assert.equal(first.buffer.byteLength, 4 * 3 * 2)
  assert.deepEqual(new Uint8Array(first.buffer), new Uint8Array(second.buffer))
})

test('WASM camera forwards start and stop to the browser Host.Camera bridge when present', async () => {
  const calls: unknown[] = []
  const previousHost = setHostCamera({
    start(options) {
      calls.push({ start: options })
    },
    stop() {
      calls.push({ stop: true })
    },
  })

  try {
    const camera = new Camera()

    await camera.start({ width: 2, height: 2 })
    await camera.stop()

    assert.deepEqual(calls, [{ start: { width: 2, height: 2, useBrowserCamera: true } }, { stop: true }])
  } finally {
    globalThis.Host = previousHost
  }
})

test('WASM camera uses the native browser camera bridge when it is preloaded', async () => {
  const calls: unknown[] = []
  const buffer = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]).buffer
  const previousBridge = setWasmCameraBridge({
    start(width, height, useBrowserCamera) {
      calls.push({ start: { width, height, useBrowserCamera } })
    },
    stop() {
      calls.push({ stop: true })
    },
    capture(width, height) {
      calls.push({ capture: { width, height } })
      return { width, height, imageType: 'rgb565le', buffer }
    },
  })

  try {
    const camera = new Camera()
    await camera.start({ width: 200, height: 120, imageType: 'rgb565le' })
    const frame = await camera.capture({ width: 200, height: 120, imageType: 'rgb565le' })
    await camera.stop()

    assert.deepEqual(calls, [
      { start: { width: 200, height: 120, useBrowserCamera: true } },
      { capture: { width: 200, height: 120 } },
      { stop: true },
    ])
    assert.ok(frame)
    assert.notEqual(frame.buffer, buffer)
    assert.deepEqual(new Uint8Array(frame.buffer), new Uint8Array(buffer))
  } finally {
    setWasmCameraBridge(previousBridge)
  }
})

test('WASM camera constructor can disable the browser camera default', async () => {
  const calls: unknown[] = []
  const previousBridge = setWasmCameraBridge({
    start(width, height, useBrowserCamera) {
      calls.push({ start: { width, height, useBrowserCamera } })
    },
    stop() {},
    capture() {
      return undefined
    },
  })

  try {
    const camera = new Camera({ useBrowserCamera: false })
    await camera.start({ width: 3, height: 4 })

    assert.deepEqual(calls, [{ start: { width: 3, height: 4, useBrowserCamera: false } }])
  } finally {
    setWasmCameraBridge(previousBridge)
  }
})

test('WASM camera copies Host.Camera capture frames into local ArrayBuffers', async () => {
  const buffer = new ArrayBuffer(8)
  const previousHost = setHostCamera({
    capture(options) {
      assert.deepEqual(options, { width: 2, height: 2, imageType: 'rgb565le' })
      return { width: 2, height: 2, imageType: 'rgb565le', buffer }
    },
  })

  try {
    const frame = await new Camera().capture({ width: 2, height: 2, imageType: 'rgb565le' })

    assert.deepEqual(frame, { width: 2, height: 2, imageType: 'rgb565le', buffer })
  } finally {
    globalThis.Host = previousHost
  }
})

test('WASM camera falls back to synthetic RGB565LE frames when Host.Camera capture returns undefined', async () => {
  const previousHost = setHostCamera({
    capture() {
      return undefined
    },
  })

  try {
    const frame = await new Camera().capture({ width: 2, height: 2, imageType: 'rgb565le' })

    assert.equal(frame?.buffer.byteLength, 2 * 2 * 2)
  } finally {
    globalThis.Host = previousHost
  }
})

test('WASM camera surfaces Host.Camera bridge errors consistently with other WASM bridges', async () => {
  const previousHost = setHostCamera({
    capture() {
      throw new Error('camera bridge failed')
    },
  })

  try {
    await assert.rejects(() => new Camera().capture({ width: 2, height: 2 }), /camera bridge failed/)
  } finally {
    globalThis.Host = previousHost
  }
})

test('WASM synthetic camera start and stop are safe around capture', async () => {
  const camera = new Camera()

  await camera.start({ width: 2, height: 2 })
  const frame = await camera.capture({ width: 2, height: 2 })
  await camera.stop()
  await camera.stop()

  assert.equal(frame?.buffer.byteLength, 2 * 2 * 2)
})

test('WASM synthetic camera keeps unsupported formats and JPEG convenience out of scope', async () => {
  const camera = new Camera()

  assert.equal(await camera.capture({ imageType: 'jpeg' }), undefined)
  assert.equal('captureJpeg' in camera, false)
})

test('lin camera backend is safe when no device camera exists', async () => {
  const camera = new FallbackCamera()

  await camera.start()
  assert.equal(await camera.capture({ width: 1, height: 1, imageType: 'rgb565le' }), undefined)
  await camera.stop()
  assert.equal('captureJpeg' in camera, false)
})

test('WASM tone forwards tone requests and close to the browser Host.AudioOut bridge', async () => {
  const previousHost = globalThis.Host
  const calls: unknown[] = []
  globalThis.Host = {
    AudioOut: {
      async tone(message: unknown) {
        calls.push(message)
      },
      close() {
        calls.push('close')
      },
    },
  }

  try {
    const tone = new Tone()

    await tone.tone(440, 250, 0.5)
    tone.close()

    assert.deepEqual(calls, [{ hz: 440, duration: 250, volume: 0.5 }, 'close'])
  } finally {
    globalThis.Host = previousHost
  }
})

test('WASM tone plays buffers through the browser Host.AudioOut bridge', async () => {
  const previousHost = globalThis.Host
  const buffers: ArrayBuffer[] = []
  globalThis.Host = {
    AudioOut: {
      async play(buffer: ArrayBuffer) {
        buffers.push(buffer)
        return true
      },
    },
  }

  try {
    const buffer = new Uint8Array([1, 2, 3]).buffer
    const result = await new Tone().play(buffer)

    assert.equal(result, true)
    assert.deepEqual(buffers, [buffer])
  } finally {
    globalThis.Host = previousHost
  }
})
