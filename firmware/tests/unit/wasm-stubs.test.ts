import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import FallbackCamera from '../../stackchan/camera.js'
import {
  DynamixelDriver,
  M5StackChanServoDriver,
  NoneDriver,
  PWMServoDriver,
  RS30XDriver,
  SCServoDriver,
  WasmDriver,
} from '../../stackchan/drivers/wasm/wasm-driver.js'
import Camera from '../../stackchan/wasm/camera.js'
import Microphone from '../../stackchan/wasm/microphone.js'
import Tone from '../../stackchan/wasm/tone.js'

type Rotation = { y: number; p: number; r: number }
type DriverConstructor = new (
  options?: unknown,
) => {
  applyRotation(rotation: Rotation, time?: number): Promise<void>
  getRotation(): Promise<unknown>
  setTorque(torque: boolean): Promise<void>
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

for (const [name, Driver] of driverCases) {
  test(`${name} WASM driver alias uses the consolidated WasmDriver bridge`, async () => {
    assert.equal(Driver, WasmDriver)

    const result = await new Driver().getRotation()

    assert.deepEqual(result, { success: true, value: { y: 0, p: 0, r: 0 } })
  })
}

test('WASM manifest keeps concrete servo driver module specifiers as facades for Moddable resolution', () => {
  const manifest = JSON.parse(readFileSync('stackchan/manifest_wasm.json', 'utf8'))

  assert.equal(manifest.modules.camera, './wasm/camera')
  assert.equal(manifest.modules['wasm-audio-bridge'], './wasm/audio-bridge')
  assert.equal(manifest.modules['wasm-camera-bridge'], './wasm/camera-bridge')
  assert.ok(manifest.preload.includes('wasm-camera-bridge'))
  assert.equal(manifest.modules['embedded:io/audio/in'], './wasm/audio-in')
  assert.equal(manifest.modules['wasm-driver'], './drivers/wasm/wasm-driver')
  assert.equal(manifest.modules['embedded:io/audio/in'], './wasm/audio-in')
  assert.ok(manifest.modules['*'].includes('./touch-panel'))
  assert.ok(manifest.modules['*'].includes('./touch-panel-gesture'))
  assert.ok(manifest.preload.includes('touch-panel'))
  assert.ok(manifest.preload.includes('touch-panel-gesture'))
  assert.deepEqual(
    {
      'dynamixel-driver': manifest.modules['dynamixel-driver'],
      'm5stackchan-servo-driver': manifest.modules['m5stackchan-servo-driver'],
      'none-driver': manifest.modules['none-driver'],
      'sg90-driver': manifest.modules['sg90-driver'],
      'rs30x-driver': manifest.modules['rs30x-driver'],
      'scservo-driver': manifest.modules['scservo-driver'],
      'py32-led': manifest.modules['py32-led'],
    },
    {
      'dynamixel-driver': './drivers/wasm/dynamixel-driver',
      'm5stackchan-servo-driver': './drivers/wasm/m5stackchan-servo-driver',
      'none-driver': './drivers/wasm/none-driver',
      'sg90-driver': './drivers/wasm/sg90-driver',
      'rs30x-driver': './drivers/wasm/rs30x-driver',
      'scservo-driver': './drivers/wasm/scservo-driver',
      'py32-led': './wasm/py32-led',
    },
  )
})

test('WASM servo driver facade files re-export the consolidated WasmDriver through a manifest module specifier', () => {
  const facadePaths = [
    'stackchan/drivers/wasm/dynamixel-driver.ts',
    'stackchan/drivers/wasm/m5stackchan-servo-driver.ts',
    'stackchan/drivers/wasm/none-driver.ts',
    'stackchan/drivers/wasm/sg90-driver.ts',
    'stackchan/drivers/wasm/rs30x-driver.ts',
    'stackchan/drivers/wasm/scservo-driver.ts',
  ]

  for (const facadePath of facadePaths) {
    const source = readFileSync(facadePath, 'utf8')
    assert.match(source, /from 'wasm-driver'/)
    assert.doesNotMatch(source, /\.\//)
  }
})

test('WASM PY32 LED facade re-exports the shared LED stub through a manifest module specifier', () => {
  const source = readFileSync('stackchan/wasm/py32-led.ts', 'utf8')

  assert.match(source, /from 'led'/)
  assert.doesNotMatch(source, /\.\//)
})

test('WASM main path loads an installed MOD archive before falling back to the default MOD', () => {
  const source = readFileSync('stackchan/main.ts', 'utf8')
  const wasmBlock = source.slice(source.indexOf('if (config.wasm) {'), source.indexOf('await asyncWait(100)'))

  assert.match(wasmBlock, /const wasmDefaultMod = Modules\.importNow\('default-mods\/wasm\/mod'\) as StackchanMod/)
  assert.match(wasmBlock, /let \{ onRobotCreated, onLaunch \} = wasmDefaultMod/)
  assert.match(wasmBlock, /Modules\.has\('mod'\)/)
  assert.match(wasmBlock, /Modules\.importNow\('mod'\) as StackchanMod/)
  assert.match(wasmBlock, /onRobotCreated = mod\.onRobotCreated \?\? onRobotCreated/)
  assert.match(wasmBlock, /onLaunch = mod\.onLaunch \?\? onLaunch/)
})

test('real-device camera preview stays independent from the WASM-only RuntimeBitmapPort binding', () => {
  const manifest = JSON.parse(readFileSync('stackchan/manifest.json', 'utf8'))
  const previewSource = readFileSync('stackchan/camera-preview.ts', 'utf8')

  assert.deepEqual(
    manifest.modules['*'].filter((specifier: string) => specifier.includes('camera-preview')),
    ['./camera-preview', './camera-preview-utils'],
  )
  assert.doesNotMatch(previewSource, /runtime-bitmap-port/)
  assert.doesNotMatch(previewSource, /RuntimeBitmapPort/)
  assert.match(previewSource, /new Port\(/)
  assert.match(previewSource, /onRender\?: \(mode: CameraPreviewRenderMode\) => void/)
  assert.match(previewSource, /this\.options\?\.onRender\?\.\('mosaic'\)/)
})

test('WASM camera preview uses a native RuntimeBitmapPort binding before falling back to mosaic', () => {
  const manifest = JSON.parse(readFileSync('stackchan/manifest_wasm.json', 'utf8'))
  const previewSource = readFileSync('stackchan/wasm/camera-preview.ts', 'utf8')
  const portSource = readFileSync('stackchan/runtime-bitmap-port.js', 'utf8')

  assert.equal(manifest.modules['camera-preview'], './wasm/camera-preview')
  assert.equal(manifest.modules['runtime-bitmap-port'], './runtime-bitmap-port')
  assert.match(portSource, /drawBitmap\(bitmap, x, y, sx = 0, sy = 0, sw = bitmap\.width, sh = bitmap\.height\)/)
  assert.match(portSource, /xs_stackchan_runtime_bitmap_port_draw/)
  assert.match(previewSource, /import RuntimeBitmapPort from 'runtime-bitmap-port'/)
  assert.match(previewSource, /from 'camera-preview-utils'/)
  assert.doesNotMatch(previewSource, /^import (?!type).*from '\.\.\//m)
  assert.match(previewSource, /new RuntimeBitmapPort\(/)
  assert.match(previewSource, /reportRenderMode\('runtime-bitmap-port'\)/)
  assert.doesNotMatch(previewSource, /ENABLE_RUNTIME_TEXTURE_PREVIEW/)
  assert.doesNotMatch(previewSource, /drawRgb565Texture/)
})

test('WASM camera preview can be dismissed by touch or an automatic timeout', () => {
  const previewSource = readFileSync('stackchan/camera-preview.ts', 'utf8')
  const modSource = readFileSync('stackchan/default-mods/on-robot-created.ts', 'utf8')

  assert.match(previewSource, /onDismiss\?: \(\) => void/)
  assert.match(previewSource, /active: true/)
  assert.match(previewSource, /onTouchEnded\(_port: PiuPort\)/)
  assert.match(previewSource, /this\.options\?\.onDismiss\?\.\(\)/)
  assert.match(modSource, /CAMERA_PREVIEW_DURATION_MS = 5000/)
  assert.match(modSource, /onDismiss: restoreCameraPreview/)
  assert.match(modSource, /distribute\?\.\('onDrawerClose'\)/)
  assert.match(modSource, /closeDrawer\(\)/)
  assert.match(modSource, /Timer\.set\(restoreCameraPreview, CAMERA_PREVIEW_DURATION_MS\)/)
  assert.doesNotMatch(modSource, /robot\.camera\.stop\(\)/)
})

test('WasmDriver applyRotation pushes pose changes to the browser Host.Driver bridge', async () => {
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

    await driver.applyRotation(rotation, 0.75)

    assert.deepEqual(calls, [{ rotation, time: 0.75 }])
    assert.deepEqual(await driver.getRotation(), { success: true, value: rotation })
  } finally {
    globalThis.Host = previousHost
  }
})

test('WasmDriver applyRotation rejects invalid rotation payloads without mutating state or calling the host bridge', async () => {
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
    await driver.applyRotation(validRotation)

    await assert.rejects(() => driver.applyRotation({ y: Number.NaN, p: 0, r: 0 } as Rotation), TypeError)

    assert.deepEqual(calls, [{ rotation: validRotation, time: undefined }])
    assert.deepEqual(await driver.getRotation(), {
      success: true,
      value: validRotation,
    })
  } finally {
    globalThis.Host = previousHost
  }
})

test('WasmDriver setTorque forwards torque state to the browser Host.Driver bridge when present', async () => {
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
    await new WasmDriver().setTorque(true)

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

    assert.deepEqual(calls, [{ start: { width: 2, height: 2 } }, { stop: true }])
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
    await camera.start({ width: 200, height: 120, imageType: 'rgb565le', useBrowserCamera: true })
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

test('default camera backend is safe when no device camera exists', async () => {
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
