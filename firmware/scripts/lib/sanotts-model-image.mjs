import { createHash } from 'node:crypto'

export const sanottsModelFormat = Object.freeze({
  partitionLabel: 'sanotts_model',
  partitionType: 1,
  partitionSubtype: 0x40,
  partitionOffset: 0xef0000,
  partitionSize: 0xb0000,
  flashSize: 0x1000000,
  headerBytes: 64,
  payloadOffset: 4096,
  payloadBytes: 654032,
  sha256: 'a1eb6b0812e2ad2a228836088a3e34160cb66731492fb957a5891605db2fa1b6',
})

const MAGIC = Buffer.from('SANOMDL1')
const COMMIT = Buffer.from('COMMIT01')
const TENSOR_ENTRY_BYTES = 104

/** Validate the pinned v1.2.0/v4 model, not an arbitrary SAAN-shaped buffer. */
export function validateSanoModelPayload(bytes) {
  const payload = asBuffer(bytes)
  if (payload.length !== sanottsModelFormat.payloadBytes) throw new Error('Invalid sanoTTS model length')
  if (!payload.subarray(0, 4).equals(Buffer.from('SAAN')) || payload.readUInt32LE(4) !== 2)
    throw new Error('Invalid sanoTTS SAAN format/version')
  const tensors = payload.readUInt32LE(8)
  const tableEnd = 16 + tensors * TENSOR_ENTRY_BYTES
  if (tensors !== 183 || tableEnd > payload.length) throw new Error('Invalid sanoTTS tensor table')
  const names = new Set()
  for (let index = 0; index < tensors; index++) {
    const entry = 16 + index * TENSOR_ENTRY_BYTES
    const rawName = payload.subarray(entry, entry + 64)
    const nameEnd = rawName.indexOf(0)
    if (nameEnd <= 0) throw new Error('Invalid sanoTTS tensor name')
    const name = rawName.subarray(0, nameEnd).toString('ascii')
    if (names.has(name)) throw new Error('Duplicate sanoTTS tensor name')
    names.add(name)
    const dtype = payload.readUInt32LE(entry + 64)
    const offset = payload.readBigUInt64LE(entry + 88)
    const length = payload.readBigUInt64LE(entry + 96)
    if (
      dtype > 2 ||
      offset < BigInt((tableEnd + 15) & ~15) ||
      offset % 16n !== 0n ||
      length === 0n ||
      offset + length > BigInt(payload.length)
    )
      throw new Error('Invalid sanoTTS tensor bounds/alignment')
  }
  const sha256 = createHash('sha256').update(payload).digest('hex')
  if (sha256 !== sanottsModelFormat.sha256) throw new Error('sanoTTS model SHA-256 mismatch')
  return { byteLength: payload.length, sha256, tensors }
}

/** A header is written only after the payload has been verified on flash. */
export function createSanoModelHeader(bytes) {
  validateSanoModelPayload(bytes)
  const header = Buffer.alloc(sanottsModelFormat.headerBytes)
  MAGIC.copy(header, 0)
  header.writeUInt32LE(1, 8)
  header.writeUInt32LE(sanottsModelFormat.headerBytes, 12)
  header.writeUInt32LE(sanottsModelFormat.payloadOffset, 16)
  header.writeUInt32LE(sanottsModelFormat.payloadBytes, 20)
  Buffer.from(sanottsModelFormat.sha256, 'hex').copy(header, 24)
  COMMIT.copy(header, 56)
  return header
}

/** Reject erased, partial, incompatible or corrupt committed partition images. */
export function validateSanoModelPartition(bytes) {
  const image = asBuffer(bytes)
  const format = sanottsModelFormat
  if (image.length !== format.partitionSize) throw new Error('Invalid sanoTTS partition image length')
  if (
    !image.subarray(0, 8).equals(MAGIC) ||
    image.readUInt32LE(8) !== 1 ||
    image.readUInt32LE(12) !== format.headerBytes ||
    image.readUInt32LE(16) !== format.payloadOffset ||
    image.readUInt32LE(20) !== format.payloadBytes ||
    !image.subarray(24, 56).equals(Buffer.from(format.sha256, 'hex')) ||
    !image.subarray(56, 64).equals(COMMIT)
  )
    throw new Error('Uncommitted or incompatible sanoTTS model header')
  return validateSanoModelPayload(image.subarray(format.payloadOffset, format.payloadOffset + format.payloadBytes))
}

/** Refuse legacy or ambiguous layouts before issuing any erase/write command. */
export function findSanoModelPartition(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Missing flash partition table')
  const labels = new Set()
  const ordered = [...entries].sort((a, b) => a.offset - b.offset)
  let previousEnd = 0x9000
  for (const entry of ordered) {
    if (
      !entry.label ||
      labels.has(entry.label) ||
      !Number.isSafeInteger(entry.offset) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      entry.offset < previousEnd ||
      entry.offset % 4096 !== 0 ||
      entry.size % 4096 !== 0 ||
      entry.offset + entry.size > sanottsModelFormat.flashSize
    )
      throw new Error('Invalid or overlapping flash partition layout')
    labels.add(entry.label)
    previousEnd = entry.offset + entry.size
  }
  const model = entries.find((entry) => entry.label === sanottsModelFormat.partitionLabel)
  if (
    !model ||
    model.type !== sanottsModelFormat.partitionType ||
    model.subtype !== sanottsModelFormat.partitionSubtype ||
    model.offset !== sanottsModelFormat.partitionOffset ||
    model.size !== sanottsModelFormat.partitionSize ||
    (model.flags ?? 0) !== 0
  )
    throw new Error('Dedicated sanoTTS model partition is missing or incompatible; deploy the matching host first')
  const app = entries.find((entry) => entry.label === 'factory')
  const xs = entries.find((entry) => entry.label === 'xs')
  const storage = entries.find((entry) => entry.label === 'storage')
  if (
    app?.type !== 0 ||
    app.subtype !== 0 ||
    app.offset !== 0x10000 ||
    app.size !== 0xee0000 ||
    xs?.type !== 0x40 ||
    xs.subtype !== 1 ||
    xs.offset !== 0xfa0000 ||
    xs.size !== 0x40000 ||
    storage?.type !== 1 ||
    storage.subtype !== 0x82 ||
    storage.offset !== 0xfe0000 ||
    storage.size !== 0x10000
  )
    throw new Error('Unexpected host/MOD/storage partition layout')
  return model
}

function asBuffer(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected model bytes')
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
