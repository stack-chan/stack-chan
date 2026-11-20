import { copyArrayBuffer } from 'local-peer-codec'

// Leave room for transport authentication while staying within the smallest
// datagram MTU supported by local peer backends.
export const LOCAL_PEER_FRAME_BYTES = 234
export const LOCAL_PEER_HEADER_BYTES = 18
export const LOCAL_PEER_FRAGMENT_BYTES = LOCAL_PEER_FRAME_BYTES - LOCAL_PEER_HEADER_BYTES

const MAGIC = Object.freeze([0x53, 0x4c, 0x50, 0x31]) // SLP1

export const LocalPeerFrameKind = Object.freeze({
  DISCOVER: 1,
  ANNOUNCE: 2,
  DATA: 3,
  ACK: 4,
} as const)

export type LocalPeerFrameKind = (typeof LocalPeerFrameKind)[keyof typeof LocalPeerFrameKind]

export const LocalPeerFrameFlag = Object.freeze({
  RELIABLE: 1,
  BROADCAST: 2,
} as const)

export type LocalPeerFrame = {
  kind: LocalPeerFrameKind
  flags: number
  messageId: number
  fragmentIndex: number
  fragmentCount: number
  serviceHash: number
  payload: Uint8Array
}

export function encodeLocalPeerFrame(frame: LocalPeerFrame): ArrayBuffer {
  if (frame.payload.byteLength > LOCAL_PEER_FRAGMENT_BYTES)
    throw new RangeError('local peer frame payload is too large')
  if (frame.fragmentCount < 1 || frame.fragmentCount > 255) throw new RangeError('invalid fragment count')
  if (frame.fragmentIndex < 0 || frame.fragmentIndex >= frame.fragmentCount)
    throw new RangeError('invalid fragment index')

  const bytes = new Uint8Array(LOCAL_PEER_HEADER_BYTES + frame.payload.byteLength)
  bytes.set(MAGIC, 0)
  bytes[4] = frame.kind
  bytes[5] = frame.flags
  const view = new DataView(bytes.buffer)
  view.setUint32(6, frame.messageId >>> 0)
  bytes[10] = frame.fragmentIndex
  bytes[11] = frame.fragmentCount
  view.setUint32(12, frame.serviceHash >>> 0)
  view.setUint16(16, frame.payload.byteLength)
  bytes.set(frame.payload, LOCAL_PEER_HEADER_BYTES)
  return bytes.buffer
}

export function decodeLocalPeerFrame(buffer: ArrayBuffer): LocalPeerFrame | undefined {
  if (buffer.byteLength < LOCAL_PEER_HEADER_BYTES || buffer.byteLength > LOCAL_PEER_FRAME_BYTES) return undefined
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (bytes[index] !== MAGIC[index]) return undefined
  }
  const kind = bytes[4]
  if (!Object.values(LocalPeerFrameKind).includes(kind as LocalPeerFrameKind)) return undefined
  const fragmentIndex = bytes[10]
  const fragmentCount = bytes[11]
  if (fragmentCount < 1 || fragmentIndex >= fragmentCount) return undefined
  const view = new DataView(buffer)
  const payloadLength = view.getUint16(16)
  if (LOCAL_PEER_HEADER_BYTES + payloadLength !== buffer.byteLength) return undefined
  return {
    kind: kind as LocalPeerFrameKind,
    flags: bytes[5],
    messageId: view.getUint32(6),
    fragmentIndex,
    fragmentCount,
    serviceHash: view.getUint32(12),
    payload: new Uint8Array(copyArrayBuffer(bytes.subarray(LOCAL_PEER_HEADER_BYTES))),
  }
}

export function fragmentLocalPeerPayload(
  kind: LocalPeerFrameKind,
  flags: number,
  messageId: number,
  serviceHash: number,
  payload: Uint8Array,
): ArrayBuffer[] {
  const fragmentCount = Math.max(1, Math.ceil(payload.byteLength / LOCAL_PEER_FRAGMENT_BYTES))
  if (fragmentCount > 255) throw new RangeError('local peer message has too many fragments')
  const frames: ArrayBuffer[] = []
  for (let fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
    const start = fragmentIndex * LOCAL_PEER_FRAGMENT_BYTES
    frames.push(
      encodeLocalPeerFrame({
        kind,
        flags,
        messageId,
        fragmentIndex,
        fragmentCount,
        serviceHash,
        payload: payload.subarray(start, start + LOCAL_PEER_FRAGMENT_BYTES),
      }),
    )
  }
  return frames
}
