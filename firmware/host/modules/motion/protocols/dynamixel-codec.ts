const POSITION_UNITS_PER_REVOLUTION = 4096
const DEGREES_PER_REVOLUTION = 360
const STATUS_HEADER_LENGTH = 2

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
