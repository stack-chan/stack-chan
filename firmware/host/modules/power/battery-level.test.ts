import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  readAxp192BatteryLevel,
  readAxp2101BatteryLevel,
  readCore2BatteryLevel,
  readIp5306BatteryLevel,
} from './battery-level.js'

type RegisterValues = readonly (readonly [number, number])[]

function registerReader(registers: RegisterValues) {
  const values = new Map(registers)
  return (register: number): number => {
    const value = values.get(register)
    if (value === undefined) throw new Error(`missing register 0x${register.toString(16)}`)
    return value
  }
}

function axp192Registers(millivolts: number): RegisterValues {
  const raw = Math.round(millivolts / 1.1)
  return [
    [0x01, 0x20],
    [0x78, raw >> 4],
    [0x79, raw & 0x0f],
  ]
}

test('AXP2101 reads the hardware state-of-charge only when a battery is present', () => {
  assert.equal(
    readAxp2101BatteryLevel(
      registerReader([
        [0x00, 0x08],
        [0xa4, 67],
      ]),
    ),
    67,
  )
  assert.equal(readAxp2101BatteryLevel(registerReader([[0x00, 0x00]])), undefined)
  assert.equal(
    readAxp2101BatteryLevel(
      registerReader([
        [0x00, 0x08],
        [0xa4, 101],
      ]),
    ),
    undefined,
  )
})

test('AXP192 converts battery voltage with the M5Unified Power_Class bounds', () => {
  assert.equal(readAxp192BatteryLevel(registerReader(axp192Registers(3300))), 0)
  assert.equal(readAxp192BatteryLevel(registerReader(axp192Registers(3700))), 50)
  assert.equal(readAxp192BatteryLevel(registerReader(axp192Registers(4200))), 100)
  assert.equal(readAxp192BatteryLevel(registerReader([...axp192Registers(3700), [0x01, 0]])), undefined)
})

test('Core2 selects the reader from the PMIC identity register', () => {
  assert.equal(
    readCore2BatteryLevel(
      registerReader([
        [0x03, 0x4a],
        [0x00, 0x08],
        [0xa4, 42],
      ]),
    ),
    42,
  )
  assert.equal(readCore2BatteryLevel(registerReader([[0x03, 0xff]])), undefined)
})

test('IP5306 exposes its four documented charge buckets', () => {
  assert.equal(readIp5306BatteryLevel(registerReader([[0x78, 0x00]])), 100)
  assert.equal(readIp5306BatteryLevel(registerReader([[0x78, 0x80]])), 75)
  assert.equal(readIp5306BatteryLevel(registerReader([[0x78, 0xc0]])), 50)
  assert.equal(readIp5306BatteryLevel(registerReader([[0x78, 0xe0]])), 25)
  assert.equal(readIp5306BatteryLevel(registerReader([[0x78, 0xf0]])), 0)
})
