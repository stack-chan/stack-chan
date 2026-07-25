export const STACKCHAN_MAGIC = 0x5343
export const STACKCHAN_PROTOCOL_VERSION = 2
export const STACKCHAN_HEADER_BYTES = 20
export const STACKCHAN_CRC_BYTES = 4
export const STACKCHAN_MAX_PAYLOAD_BYTES = 4096

export enum StackChanFrameType {
  CONTROL = 0,
  MICROPHONE_PCM = 1,
  SPEAKER_PCM = 2,
  EXPRESSION = 3,
  MOTION = 4,
  DIAGNOSTICS = 5,
  EVENT = 6,
}

export const StackChanEventFlag = {
  START: 1,
  END: 1 << 1,
} as const

export const STACKCHAN_MAX_EVENT_BYTES = 64 * 1024

export enum StackChanControl {
  HELLO = 1,
  HELLO_ACK = 2,
  ERROR = 3,
  MIC_START = 16,
  MIC_STARTED = 17,
  MIC_STOP = 18,
  MIC_STOPPED = 19,
  SPEAKER_START = 32,
  SPEAKER_CREDIT = 33,
  SPEAKER_END = 34,
  SPEAKER_DONE = 35,
  SPEAKER_ABORT = 36,
  SPEAKER_TEXT = 37,
  STATUS = 48,
}

export enum StackChanErrorCode {
  INVALID_REQUEST = 1,
  INVALID_STREAM_DATA = 2,
  TRANSPORT_OVERFLOW = 3,
  AUDIO_OUTPUT = 4,
  BUSY = 5,
  SPEAKER_SEQUENCE_MISMATCH = 6,
  SPEAKER_BUFFER_OVERFLOW = 7,
  CAPTION_QUEUE_OVERFLOW = 8,
}

export enum StackChanStatus {
  IDLE = 0,
  RECOGNIZING = 1,
  SPEAKING = 2,
  LISTENING = 3,
  CONNECTING = 4,
  ERROR = 5,
}

export const StackChanCapability = {
  MICROPHONE_PCM: 1 << 0,
  SPEAKER_PCM: 1 << 1,
  SPEAKER_CREDIT: 1 << 2,
  SPEAKER_RATE_8000: 1 << 3,
  SPEAKER_RATE_16000: 1 << 4,
  SPEAKER_RATE_24000: 1 << 5,
  SPEAKER_TEXT: 1 << 6,
  DIAGNOSTICS: 1 << 7,
  STATUS_ICON: 1 << 8,
  STREAM_ID: 1 << 9,
  EVENT: 1 << 10,
  STATUS_EXTENDED: 1 << 11,
} as const

export const STACKCHAN_CAPABILITIES =
  StackChanCapability.MICROPHONE_PCM |
  StackChanCapability.SPEAKER_PCM |
  StackChanCapability.SPEAKER_CREDIT |
  StackChanCapability.SPEAKER_RATE_8000 |
  StackChanCapability.SPEAKER_RATE_16000 |
  StackChanCapability.SPEAKER_RATE_24000 |
  StackChanCapability.SPEAKER_TEXT |
  StackChanCapability.STATUS_ICON |
  StackChanCapability.STREAM_ID |
  StackChanCapability.EVENT |
  StackChanCapability.STATUS_EXTENDED

export type StackChanFrame = {
  type: StackChanFrameType
  flags?: number
  streamId?: number
  sequence: number
  sampleRate?: number
  payload?: Uint8Array
}

export type StackChanCrc32 = (bytes: Uint8Array, end?: number) => number

const CRC32_TABLE = new Uint32Array(256)
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC32_TABLE[index] = value >>> 0
}

export function crc32(bytes: Uint8Array, end = bytes.byteLength): number {
  let value = 0xffffffff
  for (let index = 0; index < end; index += 1) {
    value = CRC32_TABLE[(value ^ bytes[index]) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

export function encodeStackChanFrame(frame: StackChanFrame, checksum: StackChanCrc32 = crc32): Uint8Array {
  const payload = frame.payload ?? new Uint8Array(0)
  if (payload.byteLength > STACKCHAN_MAX_PAYLOAD_BYTES) throw new RangeError('payload is too large')
  if ((frame.streamId ?? 0) < 0 || (frame.streamId ?? 0) > 0xffff) throw new RangeError('stream ID is out of range')

  const result = new Uint8Array(STACKCHAN_HEADER_BYTES + payload.byteLength + STACKCHAN_CRC_BYTES)
  const view = new DataView(result.buffer)
  view.setUint16(0, STACKCHAN_MAGIC, true)
  view.setUint8(2, STACKCHAN_PROTOCOL_VERSION)
  view.setUint8(3, frame.type)
  view.setUint16(4, frame.flags ?? 0, true)
  view.setUint16(6, frame.streamId ?? 0, true)
  view.setUint32(8, frame.sequence >>> 0, true)
  view.setUint32(12, frame.sampleRate ?? 0, true)
  view.setUint32(16, payload.byteLength, true)
  result.set(payload, STACKCHAN_HEADER_BYTES)
  view.setUint32(
    STACKCHAN_HEADER_BYTES + payload.byteLength,
    checksum(result, STACKCHAN_HEADER_BYTES + payload.byteLength),
    true,
  )
  return result
}

export function decodeStackChanFrame(bytes: Uint8Array, checksum: StackChanCrc32 = crc32): StackChanFrame {
  if (bytes.byteLength < STACKCHAN_HEADER_BYTES + STACKCHAN_CRC_BYTES) throw new RangeError('frame is too short')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(0, true) !== STACKCHAN_MAGIC) throw new Error('invalid magic')
  if (view.getUint8(2) !== STACKCHAN_PROTOCOL_VERSION) throw new Error('unsupported protocol version')
  const type = view.getUint8(3)
  if (type > StackChanFrameType.EVENT) throw new Error('unknown frame type')
  const length = view.getUint32(16, true)
  if (length > STACKCHAN_MAX_PAYLOAD_BYTES) throw new RangeError('payload is too large')
  const expectedLength = STACKCHAN_HEADER_BYTES + length + STACKCHAN_CRC_BYTES
  if (bytes.byteLength !== expectedLength) throw new RangeError('frame length mismatch')
  const expectedCrc = view.getUint32(STACKCHAN_HEADER_BYTES + length, true)
  if (checksum(bytes, STACKCHAN_HEADER_BYTES + length) !== expectedCrc) throw new Error('CRC mismatch')
  return {
    type,
    flags: view.getUint16(4, true),
    streamId: view.getUint16(6, true),
    sequence: view.getUint32(8, true),
    sampleRate: view.getUint32(12, true),
    payload: bytes.slice(STACKCHAN_HEADER_BYTES, STACKCHAN_HEADER_BYTES + length),
  }
}

export class StackChanFrameParser {
  readonly #checksum: StackChanCrc32
  #pending = new Uint8Array(0)

  constructor(checksum: StackChanCrc32 = crc32) {
    this.#checksum = checksum
  }

  push(chunk: Uint8Array): StackChanFrame[] {
    if (chunk.byteLength === 0) return []
    const combined = new Uint8Array(this.#pending.byteLength + chunk.byteLength)
    combined.set(this.#pending)
    combined.set(chunk, this.#pending.byteLength)
    this.#pending = combined

    const frames: StackChanFrame[] = []
    while (this.#pending.byteLength >= STACKCHAN_HEADER_BYTES + STACKCHAN_CRC_BYTES) {
      const magicOffset = this.#findMagic()
      if (magicOffset < 0) {
        this.#pending = this.#pending.slice(Math.max(0, this.#pending.byteLength - 1))
        break
      }
      if (magicOffset > 0) this.#pending = this.#pending.slice(magicOffset)
      if (this.#pending.byteLength < STACKCHAN_HEADER_BYTES + STACKCHAN_CRC_BYTES) break

      const view = new DataView(this.#pending.buffer, this.#pending.byteOffset, this.#pending.byteLength)
      if (view.getUint8(2) !== STACKCHAN_PROTOCOL_VERSION || view.getUint8(3) > StackChanFrameType.EVENT) {
        this.#pending = this.#pending.slice(1)
        continue
      }
      const payloadLength = view.getUint32(16, true)
      if (payloadLength > STACKCHAN_MAX_PAYLOAD_BYTES) {
        this.#pending = this.#pending.slice(1)
        continue
      }
      const frameLength = STACKCHAN_HEADER_BYTES + payloadLength + STACKCHAN_CRC_BYTES
      if (this.#pending.byteLength < frameLength) break
      const candidate = this.#pending.slice(0, frameLength)
      try {
        frames.push(decodeStackChanFrame(candidate, this.#checksum))
        this.#pending = this.#pending.slice(frameLength)
      } catch {
        this.#pending = this.#pending.slice(1)
      }
    }
    return frames
  }

  reset(): void {
    this.#pending = new Uint8Array(0)
  }

  #findMagic(): number {
    for (let index = 0; index + 1 < this.#pending.byteLength; index += 1) {
      if (this.#pending[index] === 0x43 && this.#pending[index + 1] === 0x53) return index
    }
    return -1
  }
}

export class StackChanEventEncoder {
  #messageId = 0

  encode(payload: Uint8Array, maxPayload = STACKCHAN_MAX_PAYLOAD_BYTES): StackChanFrame[] {
    if (maxPayload < 1 || maxPayload > STACKCHAN_MAX_PAYLOAD_BYTES) throw new RangeError('invalid event chunk size')
    if (payload.byteLength > STACKCHAN_MAX_EVENT_BYTES) throw new RangeError('event is too large')
    this.#messageId = this.#messageId >= 0xffff ? 1 : this.#messageId + 1
    const frames: StackChanFrame[] = []
    const chunks = Math.max(1, Math.ceil(payload.byteLength / maxPayload))
    for (let sequence = 0; sequence < chunks; sequence += 1) {
      const start = sequence * maxPayload
      const end = Math.min(payload.byteLength, start + maxPayload)
      frames.push({
        type: StackChanFrameType.EVENT,
        streamId: this.#messageId,
        sequence,
        flags: (sequence === 0 ? StackChanEventFlag.START : 0) | (sequence === chunks - 1 ? StackChanEventFlag.END : 0),
        payload: payload.slice(start, end),
      })
    }
    return frames
  }
}

type PendingEvent = { nextSequence: number; chunks: Uint8Array[]; size: number }

export class StackChanEventDecoder {
  #pending = new Map<number, PendingEvent>()

  push(frame: StackChanFrame): Uint8Array | undefined {
    if (frame.type !== StackChanFrameType.EVENT) throw new TypeError('event frame is required')
    const streamId = frame.streamId ?? 0
    if (streamId === 0) throw new RangeError('event stream ID must not be zero')
    const starts = ((frame.flags ?? 0) & StackChanEventFlag.START) !== 0
    const ends = ((frame.flags ?? 0) & StackChanEventFlag.END) !== 0
    let pending = this.#pending.get(streamId)
    if (starts) {
      if (frame.sequence !== 0) throw new RangeError('first event sequence must be zero')
      pending = { nextSequence: 0, chunks: [], size: 0 }
      this.#pending.set(streamId, pending)
    }
    if (!pending) throw new Error('event continuation has no start chunk')
    if (frame.sequence !== pending.nextSequence) {
      this.#pending.delete(streamId)
      throw new RangeError('event sequence mismatch')
    }
    const payload = frame.payload ?? new Uint8Array(0)
    if (pending.size + payload.byteLength > STACKCHAN_MAX_EVENT_BYTES) {
      this.#pending.delete(streamId)
      throw new RangeError('event is too large')
    }
    pending.chunks.push(payload)
    pending.size += payload.byteLength
    pending.nextSequence += 1
    if (!ends) return
    this.#pending.delete(streamId)
    const result = new Uint8Array(pending.size)
    let offset = 0
    for (const chunk of pending.chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }

  reset(): void {
    this.#pending.clear()
  }
}

export function uint32Payload(value: number): Uint8Array {
  const payload = new Uint8Array(4)
  new DataView(payload.buffer).setUint32(0, value >>> 0, true)
  return payload
}

export function readUint32Payload(payload: Uint8Array | undefined): number {
  if (payload?.byteLength !== 4) throw new RangeError('expected a four-byte payload')
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true)
}
