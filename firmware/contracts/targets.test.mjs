import assert from 'node:assert/strict'
import { test } from 'node:test'
import { firmwareDescriptorVersion } from '../scripts/lib/moddable-version.mjs'
import { parseEspAppDescriptor } from './esp-flash.js'
import { assertModCompatibility, assertTargetIdentity, hostForTarget, parseModRuntimeContract } from './mod-package.js'
import { TARGETS, targetForBuild, targetForCode, targetProfile } from './targets.js'
import { modDefinition } from './testing/xsa-fixture.js'

const native = Object.entries(TARGETS).filter(([, profile]) => profile.deviceInstall)

test('all build targets round-trip through the actual ESP descriptor, including boards sharing a chip', () => {
  assert.equal(new Set(native.map(([, profile]) => profile.code)).size, native.length)
  for (const [id, profile] of native) {
    assert.equal(targetForBuild(profile.buildName).id, id)
    assert.equal(targetForCode(profile.code), id)
    for (const version of ['9.5.0', '9.5.0+beta']) {
      const descriptorVersion = firmwareDescriptorVersion(version, 9, id)
      const image = Buffer.alloc(256)
      image.writeUInt32LE(0xabcd5432, 0x20)
      image.write(descriptorVersion, 0x30)
      image.write('xs_esp32', 0x50)
      assert.deepEqual(parseEspAppDescriptor(image), {
        version: descriptorVersion,
        moddableVersion: version,
        hostApiVersion: 9,
        target: id,
        projectName: 'xs_esp32',
      })
      assert.equal(descriptorVersion.length < 32, true)
    }
  }
  assert.equal(targetProfile('__proto__'), undefined)
  assert.equal(targetForCode('unknown'), undefined)
  assert.throws(() => targetForBuild('unknown'))
  assert.throws(() => firmwareDescriptorVersion('9.5.0', 9, 'simulator'))
})

test('target-specific metadata works only on declared boards; portable apps still require available features', () => {
  for (const [id] of Object.entries(TARGETS).filter(([id]) => id !== 'portable')) {
    const contract = parseModRuntimeContract({ ...modDefinition, targets: [id] })
    for (const [actual] of Object.entries(TARGETS).filter(([id]) => id !== 'portable')) {
      if (id === actual) assert.doesNotThrow(() => assertModCompatibility(contract, hostForTarget(actual)))
      else
        assert.throws(() => assertModCompatibility(contract, hostForTarget(actual)), { code: 'MOD_TARGET_UNSUPPORTED' })
    }
    assert.throws(() => assertModCompatibility(contract, hostForTarget(null)), { code: 'MOD_TARGET_UNKNOWN' })
  }
  const camera = parseModRuntimeContract({ ...modDefinition, capabilities: ['camera'] })
  assert.throws(() => assertModCompatibility(camera, hostForTarget('takao-core2-sg90')), {
    code: 'MOD_CAPABILITY_UNAVAILABLE',
  })
  assert.doesNotThrow(() => assertModCompatibility(camera, hostForTarget('m5stackchan-cores3')))
  assert.doesNotThrow(() =>
    assertModCompatibility({ ...camera, optionalCapabilities: ['camera'] }, hostForTarget('takao-core2-sg90')),
  )
  assert.doesNotThrow(() => assertModCompatibility(parseModRuntimeContract(modDefinition), hostForTarget(null)))
  assert.throws(() => parseModRuntimeContract({ ...modDefinition, targets: ['m5stackchan_cores3'] }), {
    code: 'MOD_METADATA_INVALID',
  })
})

test('selected targets cannot stand in for an unknown or different firmware board', () => {
  assert.doesNotThrow(() => assertTargetIdentity('m5stackchan-cores3', 'm5stackchan-cores3'))
  assert.throws(() => assertTargetIdentity('stackchan-rt', 'm5stackchan-cores3'), { code: 'MOD_TARGET_UNSUPPORTED' })
  for (const unknown of [null, undefined, 'esp32s3', 'future-board'])
    assert.throws(() => assertTargetIdentity(unknown, 'm5stackchan-cores3'), { code: 'MOD_TARGET_UNKNOWN' })
})
