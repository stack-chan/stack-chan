const POSITION_UNITS_PER_REVOLUTION = 4096
const DEGREES_PER_REVOLUTION = 360
const STATUS_HEADER_LENGTH = 2
const CRC_LENGTH = 2

/**
 * calculates the Dynamixel protocol 2.0 CRC-16 (polynomial 0x8005, init 0)
 * @param values - packet bytes
 * @param start - first index included in the calculation
 * @param end - index one past the last byte included in the calculation
 * @returns 16-bit CRC value
 */
export function dynamixelCrc16(values: number[] | Uint8Array, start = 0, end = values.length): number {
  let crc = 0
  for (let i = start; i < end; i++) {
    crc ^= (values[i] & 0xff) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

/**
 * verifies the trailing little-endian CRC-16 of a received Dynamixel packet
 * @param packet - full packet bytes starting at the 0xff 0xff 0xfd header
 * @param length - packet length in bytes including the two CRC bytes
 * @returns true when the CRC matches, false otherwise
 */
export function verifyDynamixelPacketCrc(packet: Uint8Array, length = packet.length): boolean {
  if (length <= CRC_LENGTH || length > packet.length) {
    return false
  }
  const crcOffset = length - CRC_LENGTH
  const received = (packet[crcOffset] & 0xff) | ((packet[crcOffset + 1] & 0xff) << 8)
  return dynamixelCrc16(packet, 0, crcOffset) === received
}

export function int32ToDynamixelBytes(value: number): [number, number, number, number] {
  const signed = Math.trunc(value) | 0
  return [signed & 0xff, (signed >> 8) & 0xff, (signed >> 16) & 0xff, (signed >> 24) & 0xff]
}

export function int16FromDynamixelPayload(values: Uint8Array, offset = STATUS_HEADER_LENGTH): number {
  const value = (values[offset] & 0xff) | ((values[offset + 1] & 0xff) << 8)
  return value >= 0x8000 ? value - 0x10000 : value
}

export function int32FromDynamixelPayload(values: Uint8Array, offset = STATUS_HEADER_LENGTH): number {
  return (
    (values[offset] & 0xff) |
    ((values[offset + 1] & 0xff) << 8) |
    ((values[offset + 2] & 0xff) << 16) |
    ((values[offset + 3] & 0xff) << 24)
  )
}

export function dynamixelStatusPayloadHasData(
  values: Uint8Array | undefined,
  dataLength: number,
): values is Uint8Array {
  return values != null && values.length >= STATUS_HEADER_LENGTH + dataLength
}

export function angleToDynamixelPosition(angle: number): number {
  return Math.trunc((angle * POSITION_UNITS_PER_REVOLUTION) / DEGREES_PER_REVOLUTION)
}

export function dynamixelPositionToAngle(position: number): number {
  return (position * DEGREES_PER_REVOLUTION) / POSITION_UNITS_PER_REVOLUTION
}
