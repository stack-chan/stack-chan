import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildOutputDirectory } from './build-output.mjs'
import { esptoolConnectionArguments, installModArchive, resolveModArchivePath } from './mod-flash.mjs'

test('resolves mcrun archives using the observable output contract', () => {
  assert.equal(
    resolveModArchivePath({
      outputDirectory: '/repo/firmware/dist',
      mode: 'debug',
      projectName: 'look_around',
    }),
    '/repo/firmware/dist/bin/esp32/debug/look_around/look_around.xsa',
  )
  assert.equal(
    resolveModArchivePath({
      outputDirectory: '/repo/firmware/dist',
      mode: 'instrument',
      projectName: 'look_around',
    }),
    '/repo/firmware/dist/bin/esp32/instrument/look_around/look_around.xsa',
  )
  assert.equal(
    resolveModArchivePath({
      outputDirectory: '/repo/firmware/dist',
      mode: 'release',
      projectName: 'look_around',
    }),
    '/repo/firmware/dist/bin/esp32/release/look_around/look_around.xsa',
  )
})

test('reads the live partition layout before writing and verifying a MOD', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'stackchan-mod-flash-test-'))
  const archivePath = path.join(fixture, 'look_around.xsa')
  const archive = makeArchive(192)
  const partitionTable = makePartitionTable({ xsOffset: 0xfa0000, xsSize: 0x40000 })
  const appHeader = makeAppHeader({ version: '8.3.1', projectName: 'xs_esp32' })
  const calls = []
  const scratchPaths = []

  try {
    writeFileSync(archivePath, archive)
    const result = installModArchive({
      archivePath,
      chip: 'esp32s3',
      port: '/dev/ttyACM1',
      baud: 921600,
      expectedFirmwareVersion: '8.3.1',
      runCommand(command, args) {
        calls.push([command, args])
        if (args.includes('read-flash')) {
          scratchPaths.push(args.at(-1))
          assert.equal(path.dirname(path.dirname(args.at(-1))), path.join(buildOutputDirectory, 'tmp'))
          const address = Number(args.at(-3))
          writeFileSync(args.at(-1), address === 0x8000 ? partitionTable : appHeader)
        }
      },
    })

    assert.deepEqual(
      calls.map(([, args]) => args.find((arg) => ['read-flash', 'write-flash', 'verify-flash'].includes(arg))),
      ['read-flash', 'read-flash', 'write-flash', 'verify-flash'],
    )
    assert.ok(calls.every(([, args]) => args.includes('esp32s3')))
    assert.ok(calls.every(([, args]) => args.includes('/dev/ttyACM1')))
    assert.ok(calls.every(([, args]) => args.includes('921600')))
    assert.ok(calls.every(([, args]) => args.includes('hard-reset')))
    assert.equal(result.partition.offset, 0xfa0000)
    assert.equal(result.archiveSize, archive.length)
    assert.deepEqual(result.archiveVersion, [17, 8, 0])
    assert.equal(result.firmware.projectName, 'xs_esp32')
    assert.ok(calls[2][1].includes('0xfa0000'))
    assert.ok(calls[3][1].includes('0xfa0000'))
    assert.ok(scratchPaths.every((scratchPath) => !existsSync(path.dirname(scratchPath))))
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('rejects an oversized MOD before reading or writing the application partition', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'stackchan-mod-flash-size-'))
  const archivePath = path.join(fixture, 'large.xsa')
  const archive = makeArchive(192)
  let calls = 0

  try {
    writeFileSync(archivePath, archive)
    assert.throws(
      () =>
        installModArchive({
          archivePath,
          temporaryDirectory: fixture,
          runCommand(_command, args) {
            calls += 1
            writeFileSync(args.at(-1), makePartitionTable({ xsOffset: 0x3c0000, xsSize: 128 }))
          },
        }),
      /exceeds xs partition/,
    )
    assert.equal(calls, 1)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('rejects a non-Moddable firmware project before writing', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'stackchan-mod-flash-host-'))
  const archivePath = path.join(fixture, 'look_around.xsa')
  let calls = 0

  try {
    writeFileSync(archivePath, makeArchive(128))
    assert.throws(
      () =>
        installModArchive({
          archivePath,
          temporaryDirectory: fixture,
          runCommand(_command, args) {
            calls += 1
            if (calls === 1) {
              writeFileSync(args.at(-1), makePartitionTable({ xsOffset: 0xfa0000, xsSize: 0x40000 }))
            } else {
              writeFileSync(args.at(-1), makeAppHeader({ version: '8.3.1', projectName: 'other-host' }))
            }
          },
        }),
      /Unexpected firmware project/,
    )
    assert.equal(calls, 2)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('rejects an incompatible firmware version before writing', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'stackchan-mod-flash-version-'))
  const archivePath = path.join(fixture, 'look_around.xsa')
  let calls = 0

  try {
    writeFileSync(archivePath, makeArchive(128))
    assert.throws(
      () =>
        installModArchive({
          archivePath,
          expectedFirmwareVersion: '8.3.1',
          temporaryDirectory: fixture,
          runCommand(_command, args) {
            calls += 1
            if (calls === 1) {
              writeFileSync(args.at(-1), makePartitionTable({ xsOffset: 0xfa0000, xsSize: 0x40000 }))
            } else {
              writeFileSync(args.at(-1), makeAppHeader({ version: '8.4.0', projectName: 'xs_esp32' }))
            }
          },
        }),
      /Incompatible firmware version/,
    )
    assert.equal(calls, 2)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('validates optional esptool connection settings', () => {
  assert.deepEqual(esptoolConnectionArguments(), [])
  assert.deepEqual(esptoolConnectionArguments({ chip: 'esp32s3', port: '/dev/ttyUSB0', baud: '460800' }), [
    '--chip',
    'esp32s3',
    '--port',
    '/dev/ttyUSB0',
    '--baud',
    '460800',
  ])
  assert.throws(() => esptoolConnectionArguments({ chip: 'esp32s3;echo' }), /Invalid esptool chip/)
  assert.throws(() => esptoolConnectionArguments({ baud: 'fast' }), /Invalid esptool baud rate/)
})

function makeArchive(size) {
  const archive = Buffer.alloc(size)
  archive.writeUInt32BE(size, 0)
  archive.write('XS_A', 4, 'ascii')
  archive.write('VERS', 12, 'ascii')
  archive.set([17, 8, 0], 16)
  return archive
}

function makePartitionTable({ xsOffset, xsSize }) {
  const table = Buffer.alloc(0xc00, 0xff)
  writePartition(table, 0, { type: 0, subtype: 0, offset: 0x10000, size: 0xf90000, label: 'factory' })
  writePartition(table, 32, { type: 0x40, subtype: 1, offset: xsOffset, size: xsSize, label: 'xs' })
  return table
}

function writePartition(table, position, { type, subtype, offset, size, label }) {
  table.writeUInt16LE(0x50aa, position)
  table.writeUInt8(type, position + 2)
  table.writeUInt8(subtype, position + 3)
  table.writeUInt32LE(offset, position + 4)
  table.writeUInt32LE(size, position + 8)
  table.write(label, position + 12, 'ascii')
}

function makeAppHeader({ version, projectName }) {
  const header = Buffer.alloc(0x100)
  header.writeUInt32LE(0xabcd5432, 0x20)
  header.write(version, 0x30, 'utf8')
  header.write(projectName, 0x50, 'utf8')
  return header
}
