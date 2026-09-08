import { targetForCode } from './targets.js'

// Standard ESP-IDF partition table location (CONFIG_PARTITION_TABLE_OFFSET).
export const PARTITION_TABLE_OFFSET = 0x8000
export const PARTITION_TABLE_SIZE = 0xc00 // 3 KB (max 95 entries + md5)
const PARTITION_MAGIC = 0x50aa // little-endian 0xAA 0x50
const PARTITION_TYPE_XS = 0x40 // Moddable mod/archive partition
const PARTITION_SUBTYPE_XS = 0x01
const PARTITION_TYPE_APP = 0x00
const PARTITION_SUBTYPE_FACTORY = 0x00
const ESP_APP_DESC_MAGIC = 0xabcd5432
export const ESP_APP_HEADER_SIZE = 256
/**
 * @param {Uint8Array} bytes
 * Parse an ESP-IDF partition table image and return every partition entry.
 * Each entry: { type, subtype, offset, size, label }.
 */
export function parsePartitionTable(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = []
  for (let pos = 0; pos + 32 <= bytes.length; pos += 32) {
    const magic = view.getUint16(pos, true)
    if (magic !== PARTITION_MAGIC) break // 0xEBEB md5 row or padding -> end of table
    const type = view.getUint8(pos + 2)
    const subtype = view.getUint8(pos + 3)
    const offset = view.getUint32(pos + 4, true)
    const size = view.getUint32(pos + 8, true)
    let label = ''
    for (let i = 0; i < 16; i++) {
      const c = view.getUint8(pos + 12 + i)
      if (c === 0) break
      label += String.fromCharCode(c)
    }
    entries.push({ type, subtype, offset, size, label })
  }
  return entries
}

/**
 * Locate the Moddable `xs` MOD partition (type 0x40, subtype 1) in a parsed
 * partition table. Returns { offset, size } or throws.
 */
/** @param {ReturnType<typeof parsePartitionTable>} entries */
export function findXsPartition(entries) {
  const xs = entries.find((e) => e.type === PARTITION_TYPE_XS && e.subtype === PARTITION_SUBTYPE_XS)
  if (!xs) {
    const seen = entries.map((e) => `${e.label}(0x${e.type.toString(16)}/${e.subtype})`).join(', ')
    throw new Error(`MOD用の xs パーティションが見つかりません。検出: ${seen || 'なし'}`)
  }
  return xs
}

/** @param {ReturnType<typeof parsePartitionTable>} entries */
export function findAppPartition(entries) {
  const app =
    entries.find((entry) => entry.type === PARTITION_TYPE_APP && entry.subtype === PARTITION_SUBTYPE_FACTORY) ??
    entries.find((entry) => entry.type === PARTITION_TYPE_APP)
  if (!app) throw new Error('ファームウェアのappパーティションが見つかりません')
  return app
}

/** @param {Uint8Array} bytes @param {number} offset @param {number} length */
function readCString(bytes, offset, length) {
  let value = ''
  for (let index = 0; index < length && offset + index < bytes.length; index += 1) {
    const byte = bytes[offset + index]
    if (byte === 0) break
    value += String.fromCharCode(byte)
  }
  return value.trim()
}

/** @param {Uint8Array} bytes */
export function parseEspAppDescriptor(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 0x70) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0x20, true) !== ESP_APP_DESC_MAGIC) return null
  const version = readCString(bytes, 0x30, 32)
  const hostVersion = /^(.*?)(?:\+stackchan|\.stackchan)\.([1-9][0-9]*)(?:\.([a-z0-9]+))?$/.exec(version)
  return {
    version,
    moddableVersion: hostVersion?.[1] ?? version,
    hostApiVersion: hostVersion ? Number(hostVersion[2]) : 0,
    target: hostVersion?.[3] ? (targetForCode(hostVersion[3]) ?? null) : null,
    projectName: readCString(bytes, 0x50, 32),
  }
}

/** @param {Uint8Array} bytes */
export function xsArchiveByteLength(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null
  if (String.fromCharCode(...bytes.subarray(4, 8)) !== 'XS_A') return null
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false)
  return size >= 8 ? size : null
}
