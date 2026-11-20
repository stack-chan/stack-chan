import assert from 'node:assert/strict'
import test from 'node:test'

import {
  angleToDynamixelPosition,
  dynamixelCrc16,
  dynamixelPositionToAngle,
  dynamixelStatusPayloadHasData,
  int16FromDynamixelPayload,
  int32FromDynamixelPayload,
  int32ToDynamixelBytes,
  verifyDynamixelPacketCrc,
} from '../protocols/dynamixel-codec.js'

// Ping status packet example from the Robotis e-manual (Protocol 2.0):
// header(4) id(1) length(2) instruction(1) error(1) params(3) crc(2)
const REFERENCE_STATUS_PACKET = [0xff, 0xff, 0xfd, 0x00, 0x01, 0x07, 0x00, 0x55, 0x00, 0x06, 0x04, 0x26, 0x65, 0x5d]

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

test('Dynamixel CRC-16 matches the Robotis protocol 2.0 reference vectors', () => {
  // Ping instruction packet for id 1 (e-manual example): CRC is 0x4e19
  const pingPacket = new Uint8Array([0xff, 0xff, 0xfd, 0x00, 0x01, 0x03, 0x00, 0x01])
  assert.equal(dynamixelCrc16(pingPacket), 0x4e19)
  // Ping status packet from id 1 (e-manual example): CRC is 0x5d65
  const statusBody = new Uint8Array(REFERENCE_STATUS_PACKET.slice(0, -2))
  assert.equal(dynamixelCrc16(statusBody), 0x5d65)
})

test('Dynamixel packet CRC verification accepts a valid status packet', () => {
  assert.equal(verifyDynamixelPacketCrc(new Uint8Array(REFERENCE_STATUS_PACKET)), true)
})

test('Dynamixel packet CRC verification rejects corrupted packets', () => {
  // Corrupted parameter byte (e.g. present position garbled on a noisy line)
  const corruptedParam = new Uint8Array(REFERENCE_STATUS_PACKET)
  corruptedParam[10] ^= 0x40
  assert.equal(verifyDynamixelPacketCrc(corruptedParam), false)
  // Corrupted CRC byte
  const corruptedCrc = new Uint8Array(REFERENCE_STATUS_PACKET)
  corruptedCrc[corruptedCrc.length - 1] ^= 0x01
  assert.equal(verifyDynamixelPacketCrc(corruptedCrc), false)
})

test('Dynamixel packet CRC verification honors the explicit length argument', () => {
  const packet = new Uint8Array(64)
  packet.set(REFERENCE_STATUS_PACKET)
  assert.equal(verifyDynamixelPacketCrc(packet, REFERENCE_STATUS_PACKET.length), true)
  assert.equal(verifyDynamixelPacketCrc(packet, REFERENCE_STATUS_PACKET.length - 1), false)
  // Degenerate lengths never pass
  assert.equal(verifyDynamixelPacketCrc(packet, 0), false)
  assert.equal(verifyDynamixelPacketCrc(packet, 2), false)
  assert.equal(verifyDynamixelPacketCrc(packet, packet.length + 1), false)
})
