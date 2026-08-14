import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type ModFlash, validateXsaArchive, writeAndVerifyXsaArchive, type XsVersionRange } from './mod-installer.js'

const compatibleVersion: XsVersionRange = [17, 7, 17, 8]

class FakeFlash implements ModFlash {
  readonly storage: Uint8Array
  readonly erased: number[] = []
  writes = 0
  corruptReadAt = -1

  constructor(
    readonly byteLength: number,
    readonly blockSize: number,
  ) {
    this.storage = new Uint8Array(byteLength).fill(0)
  }

  erase(sector: number): void {
    this.erased.push(sector)
    this.storage.fill(0xff, sector * this.blockSize, (sector + 1) * this.blockSize)
  }

  write(offset: number, byteLength: number, buffer: Uint8Array): void {
    this.writes += 1
    this.storage.set(buffer.subarray(0, byteLength), offset)
  }

  read(offset: number, byteLength: number): ArrayBuffer {
    const result = this.storage.slice(offset, offset + byteLength)
    if (this.corruptReadAt >= offset && this.corruptReadAt < offset + byteLength) {
      result[this.corruptReadAt - offset] ^= 0xff
    }
    return result.buffer
  }
}

function makeArchive(byteLength = 5000, major = 17, minor = 8): ArrayBuffer {
  const bytes = new Uint8Array(byteLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, byteLength, false)
  bytes.set([0x58, 0x53, 0x5f, 0x41], 4)
  view.setUint32(8, 12, false)
  bytes.set([0x56, 0x45, 0x52, 0x53, major, minor, 0, 0], 12)
  for (let index = 20; index < bytes.byteLength; index += 1) bytes[index] = index & 0xff
  return bytes.buffer
}

test('validates, writes, and verifies a compatible XSA archive', () => {
  const source = makeArchive()
  const flash = new FakeFlash(8192, 4096)

  const bytes = validateXsaArchive(source, flash.byteLength, compatibleVersion)
  writeAndVerifyXsaArchive(bytes, flash)

  assert.deepEqual(flash.erased, [0, 1])
  assert.equal(flash.writes, 1)
  assert.deepEqual(flash.storage.slice(0, bytes.byteLength), bytes)
})

test('rejects malformed, incompatible, and oversized archives before a flash write can begin', () => {
  const cases: Array<[string, ArrayBuffer, number, XsVersionRange]> = []
  const badMagic = makeArchive()
  new Uint8Array(badMagic)[4] = 0
  cases.push(['header', badMagic, 8192, compatibleVersion])

  const badSize = makeArchive()
  new DataView(badSize).setUint32(0, 42, false)
  cases.push(['size', badSize, 8192, compatibleVersion])

  const badVersionAtom = makeArchive()
  new Uint8Array(badVersionAtom)[12] = 0
  cases.push(['version atom', badVersionAtom, 8192, compatibleVersion])
  cases.push(['version', makeArchive(5000, 16, 9), 8192, compatibleVersion])
  cases.push(['partition', makeArchive(), 4096, compatibleVersion])

  for (const [message, archive, maximumBytes, range] of cases) {
    assert.throws(() => validateXsaArchive(archive, maximumBytes, range), new RegExp(message))
  }
})

test('reports a read-back mismatch after writing', () => {
  const flash = new FakeFlash(8192, 4096)
  const bytes = validateXsaArchive(makeArchive(), flash.byteLength, compatibleVersion)
  flash.corruptReadAt = 4500

  assert.throws(() => writeAndVerifyXsaArchive(bytes, flash), /verification failed at 4500/)
  assert.equal(flash.writes, 1)
})
