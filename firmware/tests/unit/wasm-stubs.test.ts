import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DynamixelDriver as AggregatedDynamixelDriver,
  NoneDriver as AggregatedNoneDriver,
  PWMServoDriver as AggregatedPWMServoDriver,
  RS30XDriver as AggregatedRS30XDriver,
  SCServoDriver as AggregatedSCServoDriver,
} from '../../stackchan/drivers/wasm/driver-stub.js'
import { DynamixelDriver } from '../../stackchan/drivers/wasm/dynamixel-driver.js'
import { NoneDriver } from '../../stackchan/drivers/wasm/none-driver.js'
import { RS30XDriver } from '../../stackchan/drivers/wasm/rs30x-driver.js'
import { PWMServoDriver } from '../../stackchan/drivers/wasm/sg90-driver.js'
import { SCServoDriver } from '../../stackchan/drivers/wasm/scservo-driver.js'
import Microphone from '../../stackchan/wasm/microphone.js'

type DriverConstructor = new (
  options?: unknown,
) => {
  getRotation(): Promise<unknown>
}

const driverCases: Array<[string, DriverConstructor]> = [
  ['aggregated dynamixel', AggregatedDynamixelDriver],
  ['aggregated none', AggregatedNoneDriver],
  ['aggregated pwm', AggregatedPWMServoDriver],
  ['aggregated rs30x', AggregatedRS30XDriver],
  ['aggregated scservo', AggregatedSCServoDriver],
  ['dynamixel', DynamixelDriver],
  ['none', NoneDriver],
  ['pwm', PWMServoDriver],
  ['rs30x', RS30XDriver],
  ['scservo', SCServoDriver],
]

for (const [name, Driver] of driverCases) {
  test(`${name} WASM driver getRotation returns a Maybe success result`, async () => {
    const result = await new Driver().getRotation()

    assert.deepEqual(result, { success: true, value: { y: 0, p: 0, r: 0 } })
  })
}

test('WASM microphone keeps the optional duration argument compatible with the shared API', async () => {
  const microphone = new Microphone()

  const result = await microphone.record(1000)

  assert.ok(result instanceof ArrayBuffer)
  assert.equal(result.byteLength, 0)
})
