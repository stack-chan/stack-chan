import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bytesToBinaryString,
  findXsPartition,
  findAppPartition,
  installModToDevice,
  equalBytes,
  removeModFromDevice,
  xsArchiveByteLength,
  parsePartitionTable,
  parseEspAppDescriptor,
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

function makeAppHeader(version = '8.3.0-1-gabcdef', projectName = 'xs_esp32') {
  const bytes = new Uint8Array(256)
  const view = new DataView(bytes.buffer)
  view.setUint32(0x20, 0xabcd5432, true)
  bytes.set(new TextEncoder().encode(version), 0x30)
  bytes.set(new TextEncoder().encode(projectName), 0x50)
  return bytes
}

function makeArchive(size = 32) {
  const archive = new Uint8Array(size)
  new DataView(archive.buffer).setUint32(0, size, false)
  archive.set([0x58, 0x53, 0x5f, 0x41], 4)
  return archive
}

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

test('reads the factory app descriptor used for firmware/XS compatibility checks', () => {
  assert.equal(findAppPartition(parsePartitionTable(CORES3_TABLE)).offset, 0x10000)
  assert.deepEqual(parseEspAppDescriptor(makeAppHeader()), {
    version: '8.3.0-1-gabcdef',
    projectName: 'xs_esp32',
  })
  assert.equal(parseEspAppDescriptor(new Uint8Array(256)), null)
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
  const bytes = Uint8Array.from({ length: 0x8000 + 257 }, (_, index) => index & 0xff)
  const s = bytesToBinaryString(bytes)
  assert.equal(s.length, bytes.length)
  assert.deepEqual(
    [...s].map((c) => c.charCodeAt(0)),
    [...bytes]
  )
})

test('installModToDevice never writes when preflight is rejected', async () => {
  const calls = []
  const fakeLoader = {
    transport: {
      async disconnect() {
        calls.push('disconnect')
      },
    },
    async main() {
      return 'ESP32-S3'
    },
    async readFlash(address) {
      if (address === PARTITION_TABLE_OFFSET) return CORES3_TABLE
      if (address === 0x10000) return makeAppHeader()
      throw new Error(`unexpected read: 0x${address.toString(16)}`)
    },
    async writeFlash() {
      calls.push('write')
    },
  }
  await assert.rejects(
    installModToDevice(async () => fakeLoader, {}, makeArchive(), { onPreflight: () => false }),
    /キャンセル/
  )
  assert.deepEqual(calls, ['disconnect'])
})

test('installModToDevice reads the table, targets the xs offset, and resets', async () => {
  const archive = makeArchive()
  const calls = []
  const fakeLoader = {
    async main() {
      calls.push(['main'])
      return 'ESP32-S3'
    },
    async readFlash(addr, size) {
      calls.push(['readFlash', addr, size])
      if (addr === PARTITION_TABLE_OFFSET) return CORES3_TABLE
      if (addr === 0x10000) return makeAppHeader()
      if (addr === 0xfa0000 && size === 32 && calls.some(([name]) => name === 'writeFlash')) return archive
      return new Uint8Array(size).fill(0xff)
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
  let preflight
  const result = await installModToDevice(async () => fakeLoader, {}, archive, {
    onProgress: (ratio) => (progress = ratio),
    onPreflight: (information) => {
      preflight = information
      return true
    },
  })
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['main', 'readFlash', 'readFlash', 'readFlash', 'writeFlash', 'readFlash', 'resetToRunApp']
  )
  assert.equal(progress, 1)
  assert.equal(result.verified, true)
  assert.deepEqual(preflight.firmware, { version: '8.3.0-1-gabcdef', projectName: 'xs_esp32' })
})

test('installModToDevice does not reboot when readback verification fails', async () => {
  const archive = makeArchive()
  const calls = []
  let wrote = false
  const fakeLoader = {
    transport: {
      async disconnect() {
        calls.push('disconnect')
      },
    },
    async main() {
      return 'ESP32-S3'
    },
    async readFlash(address, size) {
      if (address === PARTITION_TABLE_OFFSET) return CORES3_TABLE
      if (address === 0x10000) return makeAppHeader()
      if (address === 0xfa0000 && size === 32 && !wrote) return new Uint8Array(size).fill(0xff)
      if (address === 0xfa0000 && wrote) {
        const mismatched = archive.slice()
        mismatched[mismatched.length - 1] ^= 0xff
        return mismatched
      }
      throw new Error(`unexpected read: 0x${address.toString(16)} / ${size}`)
    },
    async writeFlash() {
      wrote = true
      calls.push('write')
    },
    async resetToRunApp() {
      calls.push('reset')
    },
  }

  await assert.rejects(
    installModToDevice(async () => fakeLoader, {}, archive),
    /書き込み後の検証に失敗しました/
  )
  assert.deepEqual(calls, ['write', 'disconnect'])
})

test('installModToDevice rejects a MOD larger than the partition', async () => {
  const big = makeArchive(0x50000)
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

test('archive helpers validate the header size and compare verification bytes', () => {
  const archive = makeArchive(64)
  assert.equal(xsArchiveByteLength(archive), 64)
  assert.equal(xsArchiveByteLength(new Uint8Array(8)), null)
  assert.equal(equalBytes(archive, archive.slice()), true)
  archive[10] = 1
  assert.equal(equalBytes(archive, makeArchive(64)), false)
})

test('removeModFromDevice clears the first xs sector and reboots', async () => {
  const calls = []
  const existing = makeArchive(64)
  let wrote = false
  const fakeLoader = {
    async main() {
      return 'ESP32-S3'
    },
    async readFlash(address, size) {
      if (address === PARTITION_TABLE_OFFSET) return CORES3_TABLE
      if (address === 0x10000) return makeAppHeader()
      if (address === 0xfa0000 && wrote) return new Uint8Array(size).fill(0xff)
      if (address === 0xfa0000 && size === 32) return existing.slice(0, 32)
      if (address === 0xfa0000 && size === existing.length) return existing
      throw new Error(`unexpected read: 0x${address.toString(16)} / ${size}`)
    },
    async writeFlash(options) {
      calls.push(options.fileArray[0])
      wrote = true
    },
    async resetToRunApp() {
      calls.push('reset')
    },
  }
  let preflight
  let backup
  const result = await removeModFromDevice(
    async () => fakeLoader,
    {},
    {
      onPreflight: (information) => {
        preflight = information
        return true
      },
      onBackup: (bytes) => {
        backup = bytes
      },
    }
  )
  assert.equal(calls[0].address, 0xfa0000)
  assert.equal(calls[0].data.length, 4096)
  assert.equal(calls[1], 'reset')
  assert.equal(preflight.firmware.version, '8.3.0-1-gabcdef')
  assert.deepEqual(backup, existing)
  assert.equal(result.verified, true)
})
