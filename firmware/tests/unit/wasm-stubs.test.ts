import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  DynamixelDriver,
  M5StackChanServoDriver,
  NoneDriver,
  PWMServoDriver,
  RS30XDriver,
  SCServoDriver,
  WasmDriver,
} from '../../stackchan/drivers/wasm/wasm-driver.js'
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

  assert.equal(manifest.modules['wasm-driver'], './drivers/wasm/wasm-driver')
  assert.equal(manifest.modules['embedded:io/audio/in'], './wasm/audio-in')
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

  assert.match(wasmBlock, /let \{ onRobotCreated, onLaunch \} = defaultMod/)
  assert.match(wasmBlock, /Modules\.has\('mod'\)/)
  assert.match(wasmBlock, /Modules\.importNow\('mod'\) as StackchanMod/)
  assert.match(wasmBlock, /onRobotCreated = mod\.onRobotCreated \?\? onRobotCreated/)
  assert.match(wasmBlock, /onLaunch = mod\.onLaunch \?\? onLaunch/)
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
