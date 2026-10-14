import assert from 'node:assert/strict'
import test from 'node:test'
import { isXsVersionCompatible } from './xs-compatibility.mjs'
import { inspectDeploymentCompatibility } from './capabilities.mjs'

test('XS compatibility includes both endpoints and ignores patch', () => {
  const range = [17, 7, 17, 8]
  for (const patch of [0, 1, 2, 3, 255]) {
    assert.equal(isXsVersionCompatible([17, 7, patch], range), true)
    assert.equal(isXsVersionCompatible([17, 8, patch], range), true)
  }
  for (const version of [
    [17, 6, 2],
    [17, 9, 2],
    [16, 8, 2],
    [18, 8, 2],
    [17, 8],
    [17, 8, NaN],
    [17, 8, -1],
    [17, 8, 256],
    null,
    '17.8.2',
  ]) {
    assert.equal(isXsVersionCompatible(version, range), false)
  }
})
test('deployment requires a supported SDK independently of archive compatibility', () => {
  for (const firmwareVersion of ['8.3.1', '9.0.0+stackchan.1', '9.4.0', '9.50.0', '9.5.0+stackchan.1']) {
    const result = inspectDeploymentCompatibility('m5stackchan-cores3', {
      chip: 'ESP32-S3',
      xsVersion: [17, 8, 2],
      firmwareVersion,
      requireFirmware: true,
      requireArchive: true,
    })
    assert.equal(result.compatible, firmwareVersion === '9.5.0+stackchan.1')
  }
})

test('deployment keeps SDK9.5 and SDK10 archive ranges separate', () => {
  for (const firmwareVersion of ['9.5.0+stackchan.1', '10.0.0+stackchan.1']) {
    for (const minor of [6, 7, 8, 9, 10]) {
      for (const patch of [0, 2, 255]) {
        const result = inspectDeploymentCompatibility('m5stackchan-cores3', {
          chip: 'ESP32-S3',
          xsVersion: [17, minor, patch],
          firmwareVersion,
          requireFirmware: true,
          requireArchive: true,
        })
        const accepted = minor >= 7 && minor <= (firmwareVersion.startsWith('9.5.') ? 8 : 9)
        assert.equal(result.compatible, accepted, `${firmwareVersion}: XS17.${minor}.${patch}`)
        assert.deepEqual(result.diagnostics.map((item) => item.code), accepted ? [] : ['VP_XS_VERSION_MISMATCH'])
      }
    }
  }
  for (const firmwareVersion of ['10.00.0', '10.1.0', '11.0.0']) {
    const result = inspectDeploymentCompatibility('m5stackchan-cores3', {
      chip: 'ESP32-S3', xsVersion: [17, 9, 2], firmwareVersion, requireFirmware: true,
    })
    assert.equal(result.compatible, false)
    assert.ok(result.diagnostics.some((item) => item.code === 'VP_FIRMWARE_VERSION_MISMATCH'))
  }
  for (const minor of [7, 8, 9]) {
    assert.equal(inspectDeploymentCompatibility('simulator', {
      xsVersion: [17, minor, 2], requireArchive: true,
    }).compatible, true)
  }
})
