import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../testing/node-alias-package.js'

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(modulesRoot, 'mac-address', resolve(modulesRoot, 'util/sim/mac-address.js'), {
    hasDefaultExport: true,
  })
}

test('stackchan util vector and rotation helpers use the shared tuple contracts', async () => {
  installBareSpecifierPackages()
  const { Rotation, Vector3, colorsFromSeed, generateDeviceSeed, hslToRgb, quantize, toDegree, toRadian } =
    await import('./stackchan-util.js')

  assert.deepEqual(Vector3.add([1, 2, 3], [4, 5, 6]), [5, 7, 9])
  assert.deepEqual(Vector3.sub([4, 5, 6], [1, 2, 3]), [3, 3, 3])
  assert.deepEqual(Vector3.multiply([1, 2, 3], 2), [2, 4, 6])
  assert.equal(Math.round(toDegree(toRadian(90))), 90)
  assert.equal(quantize(1.01, 10), 1.1)

  const rotation = Rotation.fromVector3([1, 1, 0])
  assert.ok(rotation.y > 0)
  assert.equal(rotation.r, 0)

  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0])
  assert.equal(typeof generateDeviceSeed(), 'number')
  assert.equal(colorsFromSeed(0x12345678).length, 2)
})
