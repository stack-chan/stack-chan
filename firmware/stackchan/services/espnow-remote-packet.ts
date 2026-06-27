export type EspNowRemotePacket = {
  targetId: number
  yaw: number
  pitch: number
  speed: number
  laserEnabled: boolean
}

export type EspNowRemotePacketInput = Partial<EspNowRemotePacket> & {
  yaw: number
  pitch: number
}

export type RotationLike = {
  y: number
  p: number
}

const RAD_TO_01_DEGREE = 1800 / Math.PI

function int16LE(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset] | (bytes[offset + 1] << 8)
  return value & 0x8000 ? value - 0x10000 : value
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function parseEspNowRemotePacket(
  data: ArrayBuffer | Uint8Array,
  receiverId = 1,
): EspNowRemotePacket | undefined {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 8) {
    return undefined
  }

  const targetId = bytes[0]
  if (targetId !== 0 && targetId !== receiverId) {
    return undefined
  }

  return {
    targetId,
    yaw: clamp(int16LE(bytes, 1), -1280, 1280),
    pitch: clamp(int16LE(bytes, 3), 0, 900),
    speed: clamp(int16LE(bytes, 5), 0, 1000),
    laserEnabled: bytes[7] !== 0,
  }
}

export function remoteSpeedToPoseTime(speed: number): number {
  const clamped = clamp(speed, 0, 1000)
  return 0.1 + ((1000 - clamped) / 1000) * 0.9
}

export function rotationToEspNowRemoteAngles(rotation: RotationLike): { yaw: number; pitch: number } {
  return {
    yaw: clamp(Math.trunc(rotation.y * RAD_TO_01_DEGREE), -1280, 1280),
    pitch: clamp(Math.trunc(-rotation.p * RAD_TO_01_DEGREE), 0, 900),
  }
}

export function createEspNowRemotePacket(packet: EspNowRemotePacketInput): ArrayBuffer {
  const buffer = new ArrayBuffer(8)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  bytes[0] = clamp(packet.targetId ?? 0, 0, 255)
  view.setInt16(1, clamp(packet.yaw, -1280, 1280), true)
  view.setInt16(3, clamp(packet.pitch, 0, 900), true)
  view.setInt16(5, clamp(packet.speed ?? 600, 0, 1000), true)
  bytes[7] = packet.laserEnabled ? 1 : 0

  return buffer
}
