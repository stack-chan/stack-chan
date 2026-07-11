import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bytesToBinaryString,
  findXsPartition,
  installModToDevice,
  parsePartitionTable,
  PARTITION_TABLE_OFFSET,
  PARTITION_TABLE_SIZE,
} from './esptool-installer.mjs'

// Build a synthetic ESP-IDF partition table image.
function makePartitionTable(entries) {
  const buf = new Uint8Array(0xc00).fill(0xff)
  const view = new DataView(buf.buffer)
  entries.forEach((e, i) => {
    const pos = i * 32
    view.setUint16(pos, 0x50aa, true)
    view.setUint8(pos + 2, e.type)
    view.setUint8(pos + 3, e.subtype)
    view.setUint32(pos + 4, e.offset, true)
    view.setUint32(pos + 8, e.size, true)
    for (let c = 0; c < 16; c++) view.setUint8(pos + 12 + c, 0) // real tables zero-pad the label
    for (let c = 0; c < e.label.length && c < 15; c++) view.setUint8(pos + 12 + c, e.label.charCodeAt(c))
  })
  // md5 terminator row (magic 0xEBEB) so parsing stops
  view.setUint16(entries.length * 32, 0xebeb, true)
  return buf
}

const CORES3_TABLE = makePartitionTable([
  { type: 0x01, subtype: 0x02, offset: 0x9000, size: 0x6000, label: 'nvs' },
  { type: 0x01, subtype: 0x01, offset: 0xf000, size: 0x1000, label: 'phy_init' },
  { type: 0x00, subtype: 0x00, offset: 0x10000, size: 0xf90000, label: 'factory' },
  { type: 0x40, subtype: 0x01, offset: 0xfa0000, size: 0x40000, label: 'xs' },
  { type: 0x01, subtype: 0x82, offset: 0xfe0000, size: 0x10000, label: 'storage' },
])

test('parsePartitionTable reads all entries and stops at the terminator', () => {
  const parts = parsePartitionTable(CORES3_TABLE)
  assert.equal(parts.length, 5)
  assert.equal(parts[3].label, 'xs')
  assert.equal(parts[3].type, 0x40)
})

test('findXsPartition locates the mod partition by type/subtype', () => {
  const xs = findXsPartition(parsePartitionTable(CORES3_TABLE))
  assert.equal(xs.offset, 0xfa0000)
  assert.equal(xs.size, 0x40000)
})

test('findXsPartition works for a different board layout (4MB)', () => {
  const table = makePartitionTable([
    { type: 0x00, subtype: 0x00, offset: 0x10000, size: 0x3a0000, label: 'factory' },
    { type: 0x40, subtype: 0x01, offset: 0x3c0000, size: 0x40000, label: 'xs' },
  ])
  assert.equal(findXsPartition(parsePartitionTable(table)).offset, 0x3c0000)
})

test('findXsPartition throws when there is no xs partition', () => {
  const table = makePartitionTable([{ type: 0x00, subtype: 0x00, offset: 0x10000, size: 0x100000, label: 'factory' }])
  assert.throws(() => findXsPartition(parsePartitionTable(table)), /xs パーティションが見つかりません/)
})

test('bytesToBinaryString preserves every byte value', () => {
  const bytes = new Uint8Array([0, 1, 65, 127, 128, 200, 255])
  const s = bytesToBinaryString(bytes)
  assert.equal(s.length, bytes.length)
  assert.deepEqual(
    [...s].map((c) => c.charCodeAt(0)),
    [...bytes]
  )
})

test('installModToDevice reads the table, targets the xs offset, and resets', async () => {
  const archive = new Uint8Array([0, 0, 0, 8, 0x58, 0x53, 0x5f, 0x41]) // looks like an XS_A atom
  const calls = []
  const fakeLoader = {
    async main() {
      calls.push(['main'])
      return 'ESP32-S3'
    },
    async readFlash(addr, size) {
      calls.push(['readFlash', addr, size])
      assert.equal(addr, PARTITION_TABLE_OFFSET)
      assert.equal(size, PARTITION_TABLE_SIZE)
      return CORES3_TABLE
    },
    async writeFlash(opts) {
      calls.push(['writeFlash', opts.fileArray[0].address, opts.fileArray[0].data.length])
      assert.equal(opts.fileArray[0].address, 0xfa0000)
      assert.equal(opts.flashSize, 'keep')
      assert.equal(opts.eraseAll, false)
      assert.equal(opts.fileArray[0].data.length, archive.length)
      opts.reportProgress?.(0, archive.length, archive.length)
    },
    async resetToRunApp() {
      calls.push(['resetToRunApp'])
    },
  }
  let progress = 0
  await installModToDevice(async () => fakeLoader, {}, archive, { onProgress: (r) => (progress = r) })
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['main', 'readFlash', 'writeFlash', 'resetToRunApp']
  )
  assert.equal(progress, 1)
})

test('installModToDevice rejects a MOD larger than the partition', async () => {
  const big = new Uint8Array(0x50000)
  const fakeLoader = {
    async main() {
      return 'ESP32-S3'
    },
    async readFlash() {
      return CORES3_TABLE
    },
    async writeFlash() {
      throw new Error('should not write')
    },
    async resetToRunApp() {},
  }
  await assert.rejects(
    installModToDevice(async () => fakeLoader, {}, big),
    /MODが大きすぎます/
  )
})
