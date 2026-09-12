import assert from 'node:assert/strict'
import test from 'node:test'
import { isXsVersionCompatible } from './xs-compatibility.mjs'
import { inspectDeploymentCompatibility, profileFor } from './capabilities.mjs'

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
test('deployment requires 9.5 firmware independently of archive compatibility', () => {
  for (const firmwareVersion of ['8.3.1', '9.0.0+stackchan.1', '9.4.0', '9.50.0', '9.5.0+stackchan.1']) {
    const result = inspectDeploymentCompatibility('m5stackchan-cores3', {
      chip: 'ESP32-S3',
      xsVersion: profileFor('m5stackchan-cores3').xsArchiveVersion,
      firmwareVersion,
      requireFirmware: true,
      requireArchive: true,
    })
    assert.equal(result.compatible, firmwareVersion === '9.5.0+stackchan.1')
  }
})
