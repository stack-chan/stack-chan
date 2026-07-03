import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { Maybe, Pose, Rotation } from 'stackchan-util'
import { writeAliasPackage } from '../../testing/node-alias-package.js'
import type { MotionCompletion, MotionDriver, MotionResultCallback } from '../motion-controller.js'

type FakeTimer = {
  advance(milliseconds: number): void
  reset(): void
}

class FakeMotionDriver implements MotionDriver {
  appliedRotation: Rotation | null = null
  appliedTime: number | undefined
  attached = 0
  detached = 0
  getRotationCalls = 0
  rotation: Rotation = { y: 0, p: 0, r: 0 }
  torqueStates: boolean[] = []

  applyRotation(rotation: Rotation, time?: number, callback?: MotionCompletion): void {
    this.appliedRotation = rotation
    this.appliedTime = time
    this.rotation = rotation
    callback?.()
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    this.getRotationCalls += 1
    callback({
      success: true,
      value: this.rotation,
    })
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    this.torqueStates.push(torque)
    callback?.()
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

  controller.lookAt([1, 2, 2])

  assert.equal(driver.torqueStates[0], true)
  assert.ok(driver.appliedRotation)
  assert.equal(driver.appliedRotation.p, -Math.atan2(2, Math.sqrt(1 ** 2 + 2 ** 2)))
  assert.ok(driver.appliedTime != null && driver.appliedTime >= 0.5)
  assert.ok(driver.appliedTime != null && driver.appliedTime <= 1.0)

  fakeTimer.advance(1050)
  assert.equal(driver.torqueStates[1], false)

  controller.lookAway()
  assert.equal(controller.gazePoint, null)
})

test('MotionController polls pose only while gaze tracking needs it', async () => {
  installBareSpecifierPackages()
  const [{ MotionController }, { default: fakeTimer }] = await Promise.all([
    import('../motion-controller.js'),
    import('timer') as Promise<{ default: FakeTimer }>,
  ])
  fakeTimer.reset()
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })

  fakeTimer.advance(500)
  assert.equal(driver.getRotationCalls, 0)

  controller.lookAt([1, 2, 2])
  assert.equal(driver.getRotationCalls, 1)

  fakeTimer.advance(100)
  assert.ok(driver.getRotationCalls > 1)

  controller.lookAway()
  fakeTimer.advance(1100)
  const callsAfterMotionSettled = driver.getRotationCalls
  fakeTimer.advance(500)

  assert.equal(driver.getRotationCalls, callsAfterMotionSettled)
  controller.close()
})

test('MotionController treats lookAt(undefined) as gaze release', async () => {
  installBareSpecifierPackages()
  const [{ MotionController }, { default: fakeTimer }] = await Promise.all([
    import('../motion-controller.js'),
    import('timer') as Promise<{ default: FakeTimer }>,
  ])
  fakeTimer.reset()
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })

  controller.lookAt([1, 2, 2])
  assert.equal(controller.gazePoint?.[0], 1)

  controller.lookAt(undefined)
  assert.equal(controller.gazePoint, null)

  fakeTimer.advance(1100)
  const callsAfterMotionSettled = driver.getRotationCalls
  fakeTimer.advance(500)

  assert.equal(driver.getRotationCalls, callsAfterMotionSettled)
  controller.close()
})

test('MotionController close clears polling and pending torque release timers', async () => {
  installBareSpecifierPackages()
  const [{ MotionController }, { default: fakeTimer }] = await Promise.all([
    import('../motion-controller.js'),
    import('timer') as Promise<{ default: FakeTimer }>,
  ])
  fakeTimer.reset()
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })

  controller.lookAt([1, 2, 2])
  assert.equal(driver.torqueStates[0], true)

  controller.close()
  const callsAfterClose = driver.getRotationCalls
  fakeTimer.advance(1200)

  assert.deepEqual(driver.torqueStates, [true])
  assert.equal(driver.getRotationCalls, callsAfterClose)
})

test('MotionController delegates driver replacement, torque, and explicit pose updates', async () => {
  installBareSpecifierPackages()
  const [{ MotionController }, { default: fakeTimer }, { waitForCompletion }] = await Promise.all([
    import('../motion-controller.js'),
    import('timer') as Promise<{ default: FakeTimer }>,
    import('stackchan-util') as Promise<{
      waitForCompletion: (start: (callback: MotionCompletion) => void) => Promise<void>
    }>,
  ])
  fakeTimer.reset()
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  controller.close()

  const nextDriver = new FakeMotionDriver()
  controller.useDriver(nextDriver)

  assert.equal(driver.detached, 1)
  assert.equal(nextDriver.attached, 1)

  await waitForCompletion((callback) => controller.setTorque(true, callback))
  assert.equal(nextDriver.torqueStates[0], true)

  const pose: Pose = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0.2, p: -0.1, r: 0 },
  }
  await waitForCompletion((callback) => controller.setPose(pose, 0.25, callback))

  assert.equal(nextDriver.appliedRotation?.y, 0.2)
  assert.equal(nextDriver.appliedRotation?.p, -0.1)
  assert.equal(nextDriver.appliedTime, 0.25)
})

test('motion duration conversion helpers name protocol time units', async () => {
  installBareSpecifierPackages()
  const { motionDurationSecondsToCentiseconds, motionDurationSecondsToMilliseconds } = await import(
    '../motion-controller.js'
  )

  assert.equal(motionDurationSecondsToMilliseconds(0.5), 500)
  assert.equal(motionDurationSecondsToMilliseconds(0.1234), 123)
  assert.equal(motionDurationSecondsToMilliseconds(-1), 0)
  assert.equal(motionDurationSecondsToCentiseconds(0.5), 50)
  assert.equal(motionDurationSecondsToCentiseconds(0.126), 13)
  assert.equal(motionDurationSecondsToCentiseconds(-1), 0)
})
