import { copyArrayBuffer } from 'local-peer-codec'
import { LOCAL_PEER_FRAME_BYTES } from 'local-peer-frame'

const MAGIC = Object.freeze([0x53, 0x4c, 0x42, 0x31]) // SLB1
const VERSION = 1
const HEADER_BYTES = 22
const PEER_ID_BYTES = 6

export const BLE_LOCAL_PEER_CHUNK_BYTES = 20
export const BLELocalPeerRecordKind = Object.freeze({ HELLO: 1, DATA: 2 } as const)
export const BLELocalPeerRecordFlag = Object.freeze({ AUTHENTICATED: 1 } as const)
export const BLE_LOCAL_PEER_BROADCAST_ID = 'FFFFFFFFFFFF'

export type BLELocalPeerRecord = {
  kind: number
  authenticated: boolean
  sourceId: string
  destinationId: string
  payload: Uint8Array
  tag?: Uint8Array
}

function nibble(value: number): number {
  if (value >= 48 && value <= 57) return value - 48
  if (value >= 65 && value <= 70) return value - 65 + 10
  if (value >= 97 && value <= 102) return value - 97 + 10
  return -1
}

export function peerIdToBytes(id: string): Uint8Array {
  if (id.length !== PEER_ID_BYTES * 2) throw new RangeError('invalid BLE local peer ID')
  const result = new Uint8Array(PEER_ID_BYTES)
  for (let index = 0; index < PEER_ID_BYTES; index += 1) {
    const high = nibble(id.charCodeAt(index * 2))
    const low = nibble(id.charCodeAt(index * 2 + 1))
    if (high < 0 || low < 0) throw new RangeError('invalid BLE local peer ID')
    result[index] = (high << 4) | low
  }
  return result
}

export function bytesToPeerId(bytes: Uint8Array): string {
  if (bytes.byteLength !== PEER_ID_BYTES) throw new RangeError('invalid BLE local peer ID bytes')
  let result = ''
  for (const value of bytes) result += value.toString(16).padStart(2, '0')
  return result.toUpperCase()
}

export function encodeBLELocalPeerRecord(record: BLELocalPeerRecord): ArrayBuffer {
  if (record.payload.byteLength > LOCAL_PEER_FRAME_BYTES) throw new RangeError('BLE local peer payload is too large')
  if (record.kind !== BLELocalPeerRecordKind.HELLO && record.kind !== BLELocalPeerRecordKind.DATA)
    throw new RangeError('invalid BLE local peer record kind')
  const tagBytes = record.authenticated ? 16 : 0
  if (tagBytes !== (record.tag?.byteLength ?? 0)) throw new RangeError('invalid BLE local peer authentication tag')
  const bytes = new Uint8Array(HEADER_BYTES + record.payload.byteLength + tagBytes)
  bytes.set(MAGIC, 0)
  bytes[4] = VERSION
  bytes[5] = record.kind
  bytes[6] = record.authenticated ? BLELocalPeerRecordFlag.AUTHENTICATED : 0
  bytes.set(peerIdToBytes(record.sourceId), 8)
  bytes.set(peerIdToBytes(record.destinationId), 14)
  new DataView(bytes.buffer).setUint16(20, record.payload.byteLength)
  bytes.set(record.payload, HEADER_BYTES)
  if (record.tag) bytes.set(record.tag, HEADER_BYTES + record.payload.byteLength)
  return bytes.buffer
}

export class BLELocalPeerRecordDecoder {
  #buffer = new Uint8Array(0)

  push(chunk: ArrayBuffer): BLELocalPeerRecord[] {
    const incoming = new Uint8Array(chunk)
    const combined = new Uint8Array(this.#buffer.byteLength + incoming.byteLength)
    combined.set(this.#buffer)
    combined.set(incoming, this.#buffer.byteLength)
    this.#buffer = combined
    const records: BLELocalPeerRecord[] = []
    for (;;) {
      let start = 0
      while (start + MAGIC.length <= this.#buffer.byteLength) {
        if (MAGIC.every((value, index) => this.#buffer[start + index] === value)) break
        start += 1
      }
      if (start > 0) this.#buffer = this.#buffer.subarray(start)
      if (this.#buffer.byteLength < HEADER_BYTES) break
      if (this.#buffer[4] !== VERSION || this.#buffer[7] !== 0) {
        this.#buffer = this.#buffer.subarray(1)
        continue
      }
      const kind = this.#buffer[5]
      const flags = this.#buffer[6]
      const payloadLength = new DataView(
        this.#buffer.buffer,
        this.#buffer.byteOffset,
        this.#buffer.byteLength,
      ).getUint16(20)
      if (
        (kind !== BLELocalPeerRecordKind.HELLO && kind !== BLELocalPeerRecordKind.DATA) ||
        (flags & ~BLELocalPeerRecordFlag.AUTHENTICATED) !== 0 ||
        payloadLength > LOCAL_PEER_FRAME_BYTES
      ) {
        this.#buffer = this.#buffer.subarray(1)
        continue
      }
      const authenticated = (flags & BLELocalPeerRecordFlag.AUTHENTICATED) !== 0
      const totalLength = HEADER_BYTES + payloadLength + (authenticated ? 16 : 0)
      if (this.#buffer.byteLength < totalLength) break
      records.push({
        kind,
        authenticated,
        sourceId: bytesToPeerId(this.#buffer.subarray(8, 14)),
        destinationId: bytesToPeerId(this.#buffer.subarray(14, 20)),
        payload: new Uint8Array(copyArrayBuffer(this.#buffer.subarray(HEADER_BYTES, HEADER_BYTES + payloadLength))),
        tag: authenticated
          ? new Uint8Array(copyArrayBuffer(this.#buffer.subarray(HEADER_BYTES + payloadLength, totalLength)))
          : undefined,
      })
      this.#buffer = this.#buffer.subarray(totalLength)
    }
    if (this.#buffer.byteLength > HEADER_BYTES + LOCAL_PEER_FRAME_BYTES + 16) this.#buffer = new Uint8Array(0)
    return records
  }

  reset(): void {
    this.#buffer = new Uint8Array(0)
  }
}
