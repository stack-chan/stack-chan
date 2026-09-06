import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertModCompatibility, parseModRuntimeContract } from './mod-package.js'
import { makeXsArchive, modDefinition, xsAtom, xsPath } from './testing/xsa-fixture.js'
import { inspectModArchive } from './xsa-metadata.js'

const decode = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const code = (expected) => (error) => error.code === expected

test('application and host generations are distinct from the XS archive version', () => {
  const { metadata, version, entrypoints } = inspectModArchive(makeXsArchive(), decode)
  assert.equal(metadata.appApiVersion, 2)
  assert.deepEqual(version, [17, 8, 0])
  assert.deepEqual(entrypoints, ['mod'])
  assert.throws(() => assertModCompatibility(metadata, { hostApiVersion: 1 }), code('MOD_HOST_API_UNSUPPORTED'))
  assert.doesNotThrow(() => assertModCompatibility(metadata, { hostApiVersion: 2 }))
  const future = parseModRuntimeContract({ ...modDefinition, hostApiVersion: 3, capabilities: ['ui.piu'] })
  assert.throws(() => assertModCompatibility(future, { hostApiVersion: 2 }), code('MOD_HOST_API_UNSUPPORTED'))
  assert.doesNotThrow(() => assertModCompatibility(future, { hostApiVersion: 3, capabilities: ['ui.piu'] }))
})

test('schema 1 describes legacy API only and cannot hide explicit new requirements', () => {
  const legacy = { ...modDefinition, schemaVersion: 1 }
  delete legacy.appApiVersion
  delete legacy.hostApiVersion
  assert.equal(parseModRuntimeContract(legacy).appApiVersion, 1)
  assert.throws(() => parseModRuntimeContract({ ...legacy, appApiVersion: 2 }), code('MOD_METADATA_INVALID'))
  assert.throws(() => parseModRuntimeContract({ ...modDefinition, appApiVersion: 3 }), code('MOD_APP_API_UNSUPPORTED'))
  assert.throws(() => parseModRuntimeContract({ ...modDefinition, hostApiVersion: 1 }), code('MOD_METADATA_INVALID'))
})

test('optional hardware does not prevent apps from explaining unavailable features', () => {
  const metadata = parseModRuntimeContract({
    ...modDefinition,
    targets: ['simulator'],
    capabilities: ['face', 'camera'],
    optionalCapabilities: ['camera'],
  })
  assert.doesNotThrow(() =>
    assertModCompatibility(metadata, { hostApiVersion: 2, target: 'simulator', capabilities: ['face'] }),
  )
  assert.throws(
    () => assertModCompatibility(metadata, { hostApiVersion: 2, capabilities: ['camera'] }),
    code('MOD_CAPABILITY_UNAVAILABLE'),
  )
  assert.throws(
    () => assertModCompatibility(metadata, { hostApiVersion: 2, target: 'm5stackchan-cores3' }),
    code('MOD_TARGET_UNSUPPORTED'),
  )
  assert.throws(
    () => parseModRuntimeContract({ ...modDefinition, optionalCapabilities: ['camera'] }),
    code('MOD_METADATA_INVALID'),
  )
})

test('declared entrypoints must match the actual archive before importing any code', () => {
  assert.throws(
    () => inspectModArchive(makeXsArchive({ entrypoints: ['mod.xsb'] }), decode),
    code('MOD_ENTRYPOINT_MISMATCH'),
  )
  assert.throws(
    () => inspectModArchive(makeXsArchive({ entrypoints: ['miniapp'] }), decode),
    code('MOD_ENTRYPOINT_MISMATCH'),
  )
  assert.throws(
    () =>
      inspectModArchive(
        makeXsArchive({ metadata: { ...modDefinition, entrypoints: ['miniapp'] }, entrypoints: ['miniapp'] }),
        decode,
      ),
    code('MOD_APP_API_UNSUPPORTED'),
  )
  for (const entrypoints of [['miniapp'], ['mod', 'miniapp']]) {
    const legacy = { ...modDefinition, appApiVersion: 1, entrypoints }
    assert.throws(
      () => inspectModArchive(makeXsArchive({ metadata: legacy, entrypoints }), decode),
      code('MOD_APP_API_UNSUPPORTED'),
    )
  }
})

test('metadata-free legacy archives need an explicit transitional reader', () => {
  const bytes = makeXsArchive({ metadata: null })
  assert.throws(() => inspectModArchive(bytes, decode), code('MOD_METADATA_MISSING'))
  assert.equal(inspectModArchive(bytes, decode, { allowLegacy: true }).metadata, undefined)
  const corrupt = makeXsArchive({ metadata: { ...modDefinition, schemaVersion: 99 } })
  assert.throws(() => inspectModArchive(corrupt, decode, { allowLegacy: true }), code('MOD_METADATA_INVALID'))
})

test('atom lengths, resource decoding and duplicates are bounded', () => {
  const archive = makeXsArchive()
  for (const length of [0, 7, 19, archive.length - 1]) {
    assert.throws(() => inspectModArchive(archive.subarray(0, length), decode), code('MOD_ARCHIVE_INVALID'))
  }
  const oversized = archive.slice()
  new DataView(oversized.buffer).setUint32(8, 0xffffffff, false)
  assert.throws(() => inspectModArchive(oversized, decode), code('MOD_ARCHIVE_INVALID'))
  const leading = new Uint8Array(archive.length + 9)
  leading.set(archive, 9)
  assert.equal(inspectModArchive(leading.subarray(9), decode).metadata.id, modDefinition.id)
  for (const data of [new Uint8Array([0xff]), new Uint8Array(16385)]) {
    const malformed = xsAtom(
      'XS_A',
      xsAtom('VERS', new Uint8Array([17, 8, 0, 0])),
      xsAtom('MODS'),
      xsAtom('RSRC', xsPath('stackchan-mod.json'), xsAtom('DATA', data)),
    )
    assert.throws(
      () => inspectModArchive(malformed, decode),
      (error) => ['MOD_METADATA_INVALID', 'MOD_ARCHIVE_INVALID'].includes(error.code),
    )
  }
  const duplicates = xsAtom('XS_A', xsAtom('VERS', new Uint8Array(4)), xsAtom('VERS', new Uint8Array(4)))
  assert.throws(() => inspectModArchive(duplicates, decode), code('MOD_ARCHIVE_INVALID'))
})
