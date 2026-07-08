import assert from 'node:assert/strict'
import test from 'node:test'

import {
  angleToDynamixelPosition,
  dynamixelPositionToAngle,
  dynamixelStatusPayloadHasData,
  int16FromDynamixelPayload,
  int32FromDynamixelPayload,
  int32ToDynamixelBytes,
} from '../protocols/dynamixel-codec.js'

test('Dynamixel codec encodes signed 32-bit little-endian values', () => {
  assert.deepEqual(int32ToDynamixelBytes(1024), [0x00, 0x04, 0x00, 0x00])
  assert.deepEqual(int32ToDynamixelBytes(-1024), [0x00, 0xfc, 0xff, 0xff])
})

test('Dynamixel codec decodes signed payload values with the status header offset', () => {
  assert.equal(int16FromDynamixelPayload(new Uint8Array([0x55, 0x00, 0xff, 0xff])), -1)
  assert.equal(int32FromDynamixelPayload(new Uint8Array([0x55, 0x00, 0x00, 0xfc, 0xff, 0xff])), -1024)
  assert.equal(int32FromDynamixelPayload(new Uint8Array([0x55, 0x00, 0xff, 0xff, 0xff, 0x7f])), 2147483647)
  assert.equal(int32FromDynamixelPayload(new Uint8Array([0x55, 0x00, 0x00, 0x00, 0x00, 0x80])), -2147483648)
})

test('Dynamixel codec converts homing offset angles without losing sign', () => {
  assert.equal(angleToDynamixelPosition(90), 1024)
  assert.equal(angleToDynamixelPosition(-90), -1024)
  assert.equal(dynamixelPositionToAngle(-1024), -90)
})

test('Dynamixel status payload length check rejects two-byte payloads for four-byte registers', () => {
  assert.equal(dynamixelStatusPayloadHasData(new Uint8Array([0x55, 0x00, 0x34, 0x12]), 4), false)
  assert.equal(dynamixelStatusPayloadHasData(new Uint8Array([0x55, 0x00, 0x78, 0x56, 0x34, 0x12]), 4), true)
})
