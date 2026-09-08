import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { makeXsArchive, modDefinition } from '../../contracts/testing/xsa-fixture.js'
import { writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'

import type { ModFlash, XsVersionRange } from './mod-installer.js'

const moduleRoot = dirname(fileURLToPath(import.meta.url))
for (const name of ['mod-package', 'xsa-metadata'])
  writeAliasPackageSubpath(moduleRoot, 'stackchan-contracts', name, resolve(moduleRoot, `../../contracts/${name}.js`))
const { validateXsaArchive: validateArchive, writeAndVerifyXsaArchive } = await import('./mod-installer.js')
const validateXsaArchive = (buffer: ArrayBuffer, maximum: number, range: XsVersionRange) =>
  validateArchive(
    buffer,
    maximum,
    range,
    (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    'm5stackchan-cores3',
  )

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
  return makeXsArchive({ padding: byteLength, version: [major, minor, 0] }).buffer
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

test('rejects missing metadata, future host APIs, and mismatched entrypoints without erasing flash', () => {
  for (const source of [
    makeXsArchive({ metadata: null }),
    makeXsArchive({ metadata: { ...modDefinition, hostApiVersion: 999 } }),
    makeXsArchive({ entrypoints: ['miniapp'] }),
  ]) {
    const flash = new FakeFlash(8192, 4096)
    assert.throws(() =>
      writeAndVerifyXsaArchive(validateXsaArchive(source.buffer, flash.byteLength, compatibleVersion), flash),
    )
    assert.deepEqual(flash.erased, [])
    assert.equal(flash.writes, 0)
  }
})

test('SD target and capability checks happen before erasing a valid installed archive', () => {
  for (const [target, metadata, code] of [
    ['stackchan-rt', { ...modDefinition, targets: ['m5stackchan-cores3'] }, 'MOD_TARGET_UNSUPPORTED'],
    [null, { ...modDefinition, targets: ['m5stackchan-cores3'] }, 'MOD_TARGET_UNKNOWN'],
    ['takao-core2-sg90', { ...modDefinition, capabilities: ['camera'] }, 'MOD_CAPABILITY_UNAVAILABLE'],
  ] as Array<[string | null, typeof modDefinition, string]>) {
    const flash = new FakeFlash(8192, 4096)
    const source = makeXsArchive({ metadata })
    assert.throws(
      () =>
        writeAndVerifyXsaArchive(
          validateArchive(
            source.buffer,
            flash.byteLength,
            compatibleVersion,
            (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
            target,
          ),
          flash,
        ),
      { code },
    )
    assert.deepEqual(flash.erased, [])
    assert.equal(flash.writes, 0)
  }
})
