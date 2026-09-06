import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import FallbackCamera from '../../modules/camera/lin/camera.js'
import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
writeAliasPackage(hostRoot, 'motion-port', resolve(hostRoot, 'modules/motion/motion-port.js'))
writeAliasPackage(hostRoot, 'audio-buffer', resolve(hostRoot, 'modules/audio/audio-buffer.js'))
writeAliasPackage(hostRoot, 'tts-playback-session', resolve(hostRoot, 'modules/audio/tts-playback-session.js'))
writeAliasPackage(
  hostRoot,
  'wasm-audio-bridge-contract',
  resolve(hostRoot, 'modules/audio/wasm/audio-bridge-contract.js'),
)
const { default: Speaker } = await import('../../modules/audio/wasm/speaker.js')
const { default: Microphone } = await import('../../modules/audio/wasm/microphone.js')
const { WasmDriver } = await import('../../modules/motion/wasm/wasm-driver.js')

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

test('WasmDriver reports a neutral rotation before any pose is applied', () => {
  const result = readDriverRotation(new WasmDriver())

  assert.deepEqual(result, { success: true, value: { y: 0, p: 0, r: 0 } })
})

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

test('lin camera backend is safe when no device camera exists', async () => {
  const camera = new FallbackCamera()

  await camera.start()
  assert.equal(await camera.capture({ width: 1, height: 1, imageType: 'rgb565le' }), undefined)
  await camera.stop()
})

test('WASM speaker forwards tone requests and close to the browser Host.AudioOut bridge', async () => {
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
    const speaker = new Speaker()

    await speaker.tone(440, 250, 0.5)
    speaker.close()

    assert.deepEqual(calls, [{ hz: 440, duration: 250, volume: 0.5 }, 'close'])
  } finally {
    globalThis.Host = previousHost
  }
})

test('WASM speaker plays buffers through the browser Host.AudioOut bridge', async () => {
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
    const result = await new Speaker().play(buffer)

    assert.equal(result, true)
    assert.deepEqual(buffers, [buffer])
  } finally {
    globalThis.Host = previousHost
  }
})
