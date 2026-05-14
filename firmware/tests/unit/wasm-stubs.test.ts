import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  DynamixelDriver,
  NoneDriver,
  PWMServoDriver,
  RS30XDriver,
  SCServoDriver,
  WasmDriver,
} from '../../stackchan/drivers/wasm/wasm-driver.js'
import FallbackCamera from '../../stackchan/camera.js'
import Camera from '../../stackchan/wasm/camera.js'
import Microphone from '../../stackchan/wasm/microphone.js'

type Rotation = { y: number; p: number; r: number }
type DriverConstructor = new (
  options?: unknown,
) => {
  applyRotation(rotation: Rotation, time?: number): Promise<void>
  getRotation(): Promise<unknown>
  setTorque(torque: boolean): Promise<void>
}

const driverCases: Array<[string, DriverConstructor]> = [
  ['dynamixel', DynamixelDriver],
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
  assert.equal(manifest.modules['wasm-driver'], './drivers/wasm/wasm-driver')
  assert.deepEqual(
    {
      'dynamixel-driver': manifest.modules['dynamixel-driver'],
      'none-driver': manifest.modules['none-driver'],
      'sg90-driver': manifest.modules['sg90-driver'],
      'rs30x-driver': manifest.modules['rs30x-driver'],
      'scservo-driver': manifest.modules['scservo-driver'],
    },
    {
      'dynamixel-driver': './drivers/wasm/dynamixel-driver',
      'none-driver': './drivers/wasm/none-driver',
      'sg90-driver': './drivers/wasm/sg90-driver',
      'rs30x-driver': './drivers/wasm/rs30x-driver',
      'scservo-driver': './drivers/wasm/scservo-driver',
    },
  )
})

test('WASM servo driver facade files re-export the consolidated WasmDriver through a manifest module specifier', () => {
  const facadePaths = [
    'stackchan/drivers/wasm/dynamixel-driver.ts',
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

test('WASM microphone keeps the optional duration argument compatible with the shared API', async () => {
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
