import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { Maybe, Pose, Rotation } from 'stackchan-util'
import { writeAliasPackage } from '../../testing/node-alias-package.js'
import type { MotionDriver } from '../motion-controller.js'

type FakeTimer = {
  advance(milliseconds: number): void
  reset(): void
}

class FakeMotionDriver implements MotionDriver {
  appliedRotation: Rotation | null = null
  appliedTime: number | undefined
  attached = 0
  detached = 0
  rotation: Rotation = { y: 0, p: 0, r: 0 }
  torqueStates: boolean[] = []

  async applyRotation(rotation: Rotation, time?: number): Promise<void> {
    this.appliedRotation = rotation
    this.appliedTime = time
    this.rotation = rotation
  }

  async getRotation(): Promise<Maybe<Rotation>> {
    return {
      success: true,
      value: this.rotation,
    }
  }

  async setTorque(torque: boolean): Promise<void> {
    this.torqueStates.push(torque)
  }

  onAttached(): void {
    this.attached += 1
  }

  onDetached(): void {
    this.detached += 1
  }
}

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(modulesRoot, 'mac-address', resolve(modulesRoot, 'util/sim/mac-address.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'stackchan-util', resolve(modulesRoot, 'util/stackchan-util.js'))
}

test('MotionController follows gaze point and releases torque after movement', async () => {
  installBareSpecifierPackages()
  const [{ MotionController }, { default: fakeTimer }] = await Promise.all([
    import('../motion-controller.js'),
    import('timer') as Promise<{ default: FakeTimer }>,
  ])
  fakeTimer.reset()
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  controller.close()

  assert.equal(driver.attached, 1)

  controller.lookAt([1, 1, 0])
  await controller.updatePose()

  assert.equal(driver.torqueStates[0], true)
  assert.ok(driver.appliedRotation)
  assert.ok(driver.appliedTime != null && driver.appliedTime >= 0.5)
  assert.ok(driver.appliedTime != null && driver.appliedTime <= 1.0)

  fakeTimer.advance(1050)
  assert.equal(driver.torqueStates[1], false)

  controller.lookAway()
  assert.equal(controller.gazePoint, null)
})

test('MotionController delegates driver replacement, torque, and explicit pose updates', async () => {
  installBareSpecifierPackages()
  const [{ MotionController }, { default: fakeTimer }] = await Promise.all([
    import('../motion-controller.js'),
    import('timer') as Promise<{ default: FakeTimer }>,
  ])
  fakeTimer.reset()
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  controller.close()

  const nextDriver = new FakeMotionDriver()
  controller.useDriver(nextDriver)

  assert.equal(driver.detached, 1)
  assert.equal(nextDriver.attached, 1)

  await controller.setTorque(true)
  assert.equal(nextDriver.torqueStates[0], true)

  const pose: Pose = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0.2, p: -0.1, r: 0 },
  }
  await controller.setPose(pose, 0.25)

  assert.equal(nextDriver.appliedRotation?.y, 0.2)
  assert.equal(nextDriver.appliedRotation?.p, -0.1)
  assert.equal(nextDriver.appliedTime, 0.25)
})
