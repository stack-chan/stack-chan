import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackageSubpath } from '../../testing/node-alias-package.js'
import type { MaintenanceCommand, ServoMaintenancePort } from '../servo-maintenance.js'

async function setup() {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackageSubpath(modulesRoot, 'stackchan', 'errors', resolve(modulesRoot, '../../sdk/errors.js'))
  return import('../servo-maintenance.js')
}
function run(port: ServoMaintenancePort, command: MaintenanceCommand) {
  return new Promise((resolve, reject) =>
    port.execute(command, (error, value) => (error == null ? resolve(value) : reject(error))),
  )
}
test('SCServo calibration uses physical position without accumulating the saved offset', async () => {
  const { createServoMaintenance } = await setup()
  const offsets: number[] = []
  let saves = 0
  const servo = {
    flashId() {},
    readStatus(done) {
      done({ success: true, value: { angle: 125 } })
    },
    readOffsetAngle(done) {
      done({ success: true, value: 25 })
    },
    readRawPosition(done) {
      done({ success: true, value: { position: 640 } })
    },
    setOffsetAngle(value, done) {
      offsets.push(value)
      done()
    },
    saveSettings(done) {
      saves++
      done()
    },
  } satisfies Parameters<typeof createServoMaintenance>[1]
  const port = createServoMaintenance('scservo', servo, servo)
  await run(port, { axis: 'pan', operation: 'calibrate' })
  await run(port, { axis: 'pan', operation: 'calibrate' })
  assert.deepEqual(offsets, [25, 25])
  assert.equal(saves, 2)
})
test('DYNAMIXEL baudrate updates both existing endpoints and stops after a failed write', async () => {
  const { createServoMaintenance } = await setup()
  const writes: string[] = []
  let failPan = false
  const status = {
    readPresentPosition(done: (result: { success: true; value: number }) => void) {
      done({ success: true, value: 0 })
    },
    readPresentCurrent(done: (result: { success: true; value: { current: number } }) => void) {
      done({ success: true, value: { current: 0 } })
    },
    readPresentVelocity(done: (result: { success: true; value: number }) => void) {
      done({ success: true, value: 0 })
    },
    setLED(_enabled: boolean, done: (error?: unknown) => void) {
      done()
    },
  }
  const pan = {
    ...status,
    flashId() {},
    setBaudrate(code, done) {
      writes.push(`pan:${code}`)
      done(failPan ? Error('write failed') : undefined)
    },
  } satisfies Parameters<typeof createServoMaintenance>[1]
  const tilt = {
    ...status,
    flashId() {},
    setBaudrate(code, done) {
      writes.push(`tilt:${code}`)
      done()
    },
  } satisfies Parameters<typeof createServoMaintenance>[1]
  const port = createServoMaintenance('dynamixel', pan, tilt)
  await run(port, { axis: 'pan', operation: 'baudrate', baudrate: 1_000_000 })
  assert.deepEqual(writes, ['pan:3', 'tilt:3'])
  failPan = true
  await assert.rejects(run(port, { axis: 'pan', operation: 'baudrate', baudrate: 1_000_000 }), /write failed/)
  assert.deepEqual(writes, ['pan:3', 'tilt:3', 'pan:3'])
})
test('invalid servo IDs and unsupported calibration cannot issue persistent writes', async () => {
  const { createServoMaintenance } = await setup()
  let writes = 0
  const servo = {
    flashId() {
      writes++
    },
    readStatus(done: (value?: number, error?: unknown) => void) {
      done(0)
    },
  }
  const port = createServoMaintenance('rs30x', servo, servo)
  for (const id of [0, 128, 1.5, Number.NaN])
    await assert.rejects(run(port, { axis: 'tilt', operation: 'id', id }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(run(port, { axis: 'tilt', operation: 'calibrate' }), { code: 'UNSUPPORTED' })
  assert.equal(writes, 0)
})
