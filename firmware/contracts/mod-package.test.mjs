import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAPABILITY_HOST_API_VERSIONS } from './capabilities.js'
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

test('all retired app and metadata generations are rejected with migration guidance', () => {
  for (const legacy of [
    { ...modDefinition, schemaVersion: 1 },
    { ...modDefinition, appApiVersion: 1 },
    { ...modDefinition, appApiVersion: 3 },
  ])
    assert.throws(
      () => parseModRuntimeContract(legacy),
      (error) => error.code === 'MOD_APP_API_UNSUPPORTED' && /defineApp.*rebuild/i.test(error.message),
    )
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

test('metadata-free and corrupt archives are always rejected', () => {
  const bytes = makeXsArchive({ metadata: null })
  assert.throws(() => inspectModArchive(bytes, decode), code('MOD_METADATA_MISSING'))
  const corrupt = makeXsArchive({ metadata: { ...modDefinition, schemaVersion: 99 } })
  assert.throws(() => inspectModArchive(corrupt, decode), code('MOD_METADATA_INVALID'))
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

test('archive settings are bounded data and executable config is rejected', () => {
  const metadata = { ...modDefinition, hostApiVersion: 9, settings: { 'tts.volume': 0.3 } }
  const parsed = parseModRuntimeContract(metadata)
  metadata.settings['tts.volume'] = 0.6
  assert.equal(parsed.settings['tts.volume'], 0.3)
  assert.throws(() => parseModRuntimeContract({ ...metadata, hostApiVersion: 8 }), code('MOD_METADATA_INVALID'))
  for (const settings of [null, [], { 'tts.volume': {} }, { 'tts.volume': Infinity }, { '__proto__.value': 'x' }])
    assert.throws(() => parseModRuntimeContract({ ...metadata, settings }), code('MOD_METADATA_INVALID'))
  assert.throws(
    () => inspectModArchive(makeXsArchive({ entrypoints: ['mod', 'mod/config'] }), decode),
    code('MOD_APP_API_UNSUPPORTED'),
  )
})

test('capability declarations use SDK names and cannot claim an earlier host generation', () => {
  for (const unknown of [
    'audio.usb',
    'ui.approval',
    'connectivity.network',
    'input.buttons',
    'input.imu',
    'ui.drawer',
    'audio.speach',
  ]) {
    assert.throws(
      () => parseModRuntimeContract({ ...modDefinition, hostApiVersion: 9, capabilities: [unknown] }),
      code('MOD_METADATA_INVALID'),
    )
  }
  for (const [capability, generation] of Object.entries(CAPABILITY_HOST_API_VERSIONS)) {
    for (const optionalCapabilities of [[], [capability]]) {
      const metadata = {
        ...modDefinition,
        capabilities: [capability],
        optionalCapabilities,
        hostApiVersion: generation,
      }
      assert.doesNotThrow(() => parseModRuntimeContract(metadata))
      assert.throws(
        () => parseModRuntimeContract({ ...metadata, hostApiVersion: generation - 1 }),
        code('MOD_METADATA_INVALID'),
      )
    }
  }
})
