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
  const {
    Rotation,
    Vector3,
    colorsFromSeed,
    generateDeviceSeed,
    hslToRgb,
    quantize,
    toDegree,
    toRadian,
    writeBodyRelativeVector3,
    writePositionRelativeVector3,
    writeRotationFromVector3,
  } = await import('./stackchan-util.js')

  assert.deepEqual(Vector3.add([1, 2, 3], [4, 5, 6]), [5, 7, 9])
  assert.deepEqual(Vector3.sub([4, 5, 6], [1, 2, 3]), [3, 3, 3])
  assert.deepEqual(Vector3.multiply([1, 2, 3], 2), [2, 4, 6])
  assert.equal(Math.round(toDegree(toRadian(90))), 90)
  assert.equal(quantize(1.01, 10), 1.1)

  const rotation = Rotation.fromVector3([1, 1, 0])
  assert.ok(rotation.y > 0)
  assert.equal(rotation.r, 0)
  assert.equal(Rotation.fromVector3([1, 2, 2]).p, -Math.atan2(2, Math.sqrt(1 ** 2 + 2 ** 2)))

  const reusableVector: [number, number, number] = [0, 0, 0]
  writeBodyRelativeVector3(reusableVector, [1, 2, 2], { y: 0, p: 0, r: 0 })
  assert.deepEqual(reusableVector, [1, 2, 2])
  writePositionRelativeVector3(reusableVector, reusableVector, { x: 0.5, y: 1, z: -1 })
  assert.deepEqual(reusableVector, [0.5, 1, 3])
  const reusableRotation = { y: 0, p: 0, r: 0 }
  writeRotationFromVector3(reusableRotation, reusableVector)
  assert.equal(reusableRotation.y, Math.atan2(1, 0.5))
  assert.equal(reusableRotation.p, -Math.atan2(3, Math.sqrt(0.5 ** 2 + 1 ** 2)))
  assert.equal(reusableRotation.r, 0)

  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0])
  assert.equal(typeof generateDeviceSeed(), 'number')
  assert.equal(colorsFromSeed(0x12345678).length, 2)
})
