import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { compile } from '../../firmware/tools/avatar-dsl/compiler/compile.js'
import { buildModArchive, isXsArchive, xsArchiveVersion } from '../editor/mod-builder.mjs'
import createTools from '../editor/vendor/tools.js'
import { inspectDeploymentCompatibility } from '../editor/capabilities.mjs'
import {
  createTransferController,
  createTransferProject,
  installTransferArchive,
  MAX_TRANSFER_BYTECODE_BYTES,
} from './transfer.mjs'

const fixture = new Uint8Array(compile('fn draw()\n  fill_rect(10, 20, 30, 40, primary)\nend\n'))
const fixtureArchive = () => {
  const archive = new Uint8Array(32)
  new DataView(archive.buffer).setUint32(0, archive.length, false)
  archive.set(new TextEncoder().encode('XS_A'), 4)
  archive.set(new TextEncoder().encode('VERS'), 12)
  archive.set([17, 8, 2], 16)
  return archive
}

async function sharedProject() {
  const base = new URL('../../firmware/mods/examples/avatar-dsl/', import.meta.url)
  return createTransferProject({
    bytecode: fixture,
    nativeFaceSource: await readFile(new URL('native-face.js', base), 'utf8'),
    contextSource: await readFile(new URL('context.js', base), 'utf8'),
    fallbackBytecode: new Uint8Array(await readFile(new URL('assets/default_face.avbc', base))),
  })
}

test('packages shared native adapter and both face resources in a real WASM-built archive', async () => {
  const project = await sharedProject()
  const archive = await buildModArchive(createTools, project)
  assert.ok(isXsArchive(archive))
  const version = xsArchiveVersion(archive)
  assert.equal(
    inspectDeploymentCompatibility('m5stackchan-cores3', {
      chip: 'ESP32-S3',
      xsVersion: version,
      firmwareVersion: '10.0.1',
      requireFirmware: true,
      requireArchive: true,
    }).compatible,
    true
  )
  assert.ok(Buffer.from(archive).includes(Buffer.from(fixture)), 'compiled face is embedded unchanged')
  const fallback = project.files.find((file) => file.path.endsWith('default_face.avbc')).bytes
  assert.ok(Buffer.from(archive).includes(Buffer.from(fallback)), 'native safe fallback is embedded')
  for (const name of ['native-face.js', 'context.js']) {
    const source = await readFile(new URL(`../../firmware/mods/examples/avatar-dsl/${name}`, import.meta.url))
    assert.deepEqual(Buffer.from(project.files.find((file) => file.path === name).bytes), source)
  }
  const output = new URL('./.test-output/', import.meta.url)
  await mkdir(output, { recursive: true })
  await writeFile(
    new URL('archive.json', output),
    JSON.stringify({
      archiveBytes: archive.length,
      xsVersion: version,
      faceBytes: fixture.length,
      embeddedFaceUnchanged: true,
      fallbackIncluded: true,
    })
  )
})

test('rejects unbounded and incompatible bytecode before creating a MOD', () => {
  const options = { nativeFaceSource: '', contextSource: '', fallbackBytecode: fixture }
  assert.throws(() => createTransferProject({ ...options, bytecode: new Uint8Array(MAX_TRANSFER_BYTECODE_BYTES + 1) }))
  assert.throws(() => createTransferProject({ ...options, bytecode: new Uint8Array(16) }))
  const incompatible = fixture.slice()
  incompatible[4] = 2
  assert.throws(() => createTransferProject({ ...options, bytecode: incompatible }))
})

test('agent staging, cancellation, and synthetic confirmation never request a serial port', async () => {
  let connections = 0
  const states = []
  const controller = createTransferController({
    requestPort: () => {
      connections++
      throw new Error('No device access in this test')
    },
    onState: (state) => states.push(state),
  })
  const dom = new JSDOM('<button>Transfer</button><input type="checkbox">')
  const button = dom.window.document.querySelector('button')
  const checkbox = dom.window.document.querySelector('input')
  const cleanup = controller.bindConfirmation(button, { nativeHostCheckbox: checkbox })
  checkbox.checked = true
  controller.stage({ archive: fixtureArchive(), sourceRevision: 4 })
  assert.equal(checkbox.checked, false, 'new requests need a fresh native-host acknowledgment')
  checkbox.checked = true
  button.click()
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  assert.deepEqual(await controller.confirmFromEvent({ isTrusted: true, type: 'click', currentTarget: button }), {
    status: 'confirmation-required',
  })
  assert.equal(connections, 0)
  assert.equal(controller.pending.sourceRevision, 4)
  assert.equal(controller.pending.archiveSize, 32)
  assert.equal(controller.busy, false)
  controller.cancel()
  assert.equal(controller.pending, null)
  assert.equal(checkbox.checked, false)
  assert.ok(states.some((state) => state.status === 'awaiting-confirmation'))
  cleanup()
  dom.window.close()
})

function mockDevice({ chip = 'ESP32-S3', version = '9.5.0+stackchan.1', corrupt = false } = {}) {
  const calls = []
  const table = new Uint8Array(0xc00).fill(0xff)
  const view = new DataView(table.buffer)
  for (const [index, entry] of [
    [0, { type: 0, subtype: 0, offset: 0x10000, size: 0x390000 }],
    [1, { type: 0x40, subtype: 1, offset: 0x3b0000, size: 0x40000 }],
  ]) {
    const position = index * 32
    view.setUint16(position, 0x50aa, true)
    view.setUint8(position + 2, entry.type)
    view.setUint8(position + 3, entry.subtype)
    view.setUint32(position + 4, entry.offset, true)
    view.setUint32(position + 8, entry.size, true)
  }
  const header = new Uint8Array(256)
  new DataView(header.buffer).setUint32(0x20, 0xabcd5432, true)
  header.set(new TextEncoder().encode(version), 0x30)
  header.set(new TextEncoder().encode('stack-chan-host'), 0x50)
  let installed
  return {
    calls,
    loaderFactory: async () => ({
      async main() {
        calls.push('connect')
        return chip
      },
      async readFlash(address, size) {
        calls.push(['read', address, size])
        if (address === 0x8000) return table
        if (address === 0x10000) return header
        if (address === 0x3b0000 && installed) return corrupt ? new Uint8Array(size) : installed
        throw new Error('Unexpected flash read')
      },
      async writeFlash(options) {
        calls.push(['write', options.fileArray[0].address])
        assert.equal(options.eraseAll, false)
        installed = Uint8Array.from(options.fileArray[0].data, (letter) => letter.charCodeAt(0))
        options.reportProgress(0, installed.length, installed.length)
      },
      async resetToRunApp() {
        calls.push('reset')
      },
      transport: {
        async disconnect() {
          calls.push('disconnect')
        },
      },
    }),
  }
}

test('transport writes only discovered xs partition, reads back, resets and disconnects', async () => {
  const device = mockDevice()
  const result = await installTransferArchive({
    archive: fixtureArchive(),
    port: {},
    loaderFactory: device.loaderFactory,
  })
  assert.equal(result.status, 'installed')
  assert.equal(result.verified, true)
  assert.equal(result.partition.offset, 0x3b0000)
  assert.deepEqual(device.calls, [
    'connect',
    ['read', 0x8000, 0xc00],
    ['read', 0x10000, 256],
    ['write', 0x3b0000],
    ['read', 0x3b0000, 32],
    'reset',
    'disconnect',
  ])
})

test('incompatible devices and firmware never write and always disconnect', async () => {
  for (const options of [{ chip: 'ESP32' }, { version: '8.3.1' }]) {
    const device = mockDevice(options)
    await assert.rejects(
      installTransferArchive({ archive: fixtureArchive(), port: {}, loaderFactory: device.loaderFactory })
    )
    assert.equal(
      device.calls.some((call) => Array.isArray(call) && call[0] === 'write'),
      false
    )
    assert.equal(device.calls.at(-1), 'disconnect')
  }
})

test('cancelled request does not write and corrupt readback does not report success or reset', async () => {
  const cancelled = mockDevice()
  const result = await installTransferArchive({
    archive: fixtureArchive(),
    port: {},
    loaderFactory: cancelled.loaderFactory,
    isCurrent: () => false,
  })
  assert.equal(result.status, 'cancelled')
  assert.equal(
    cancelled.calls.some((call) => Array.isArray(call) && call[0] === 'write'),
    false
  )
  const corrupt = mockDevice({ corrupt: true })
  await assert.rejects(
    installTransferArchive({ archive: fixtureArchive(), port: {}, loaderFactory: corrupt.loaderFactory })
  )
  assert.equal(corrupt.calls.includes('reset'), false)
  assert.equal(corrupt.calls.at(-1), 'disconnect')
})

test('current archive ABI rejects an older firmware before writing', async () => {
  const archive = fixtureArchive()
  archive[17] = 9
  const older = mockDevice({ version: '9.5.0' })
  await assert.rejects(installTransferArchive({ archive, port: {}, loaderFactory: older.loaderFactory }))
  assert.equal(
    older.calls.some((call) => Array.isArray(call) && call[0] === 'write'),
    false
  )
  const current = mockDevice({ version: '10.0.1' })
  assert.equal(
    (await installTransferArchive({ archive, port: {}, loaderFactory: current.loaderFactory })).verified,
    true
  )
})
