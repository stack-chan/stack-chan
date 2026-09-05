import {
  type MotionCompletion,
  MotionController,
  type MotionDriver,
  type MotionResultCallback,
  motionDurationSecondsToCentiseconds,
  motionDurationSecondsToMilliseconds,
} from 'motion-controller'
import { type Maybe, type Pose, type Rotation, wait, waitForCompletion } from 'stackchan-util'
import { assert, equal } from 'testing/assert'

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

async function testReplacement(pose: Pose): Promise<void> {
  // Every callback retained by a replaced driver belongs to its old binding.
  // Repeating replacements also exercises cancellation of per-binding timers.
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const old = new FakeMotionDriver()
    const next = new FakeMotionDriver()
    let oldRotation: MotionResultCallback<Maybe<Rotation>> | undefined
    let nextRotation: MotionResultCallback<Maybe<Rotation>> | undefined
    old.getRotation = (callback) => {
      oldRotation = callback
    }
    next.getRotation = (callback) => {
      nextRotation = callback
    }
    const replacing = new MotionController({ driver: old }, { isPaused: () => false })
    replacing.lookAt([1, 2, 2])
    replacing.useDriver(next)
    replacing.updatePose()
    oldRotation?.({ success: true, value: { y: 3, p: 2, r: 1 } })
    equal(replacing.pose.body.rotation.y, 0, 'old samples cannot overwrite the new binding pose')
    equal(replacing.updating, true, 'old samples cannot end a new binding read')
    equal(next.torqueStates.length, 0, 'old samples cannot start a new driver command')
    nextRotation?.({ success: true, value: { y: 0.1, p: 0, r: 0 } })
    equal(replacing.pose.body.rotation.y, 0.1, 'the new binding can publish its sample')
    replacing.close()
    replacing.close()
    equal(old.detached, 1, 'replacement detaches the old binding once')
    equal(next.detached, 1, 'close detaches the new binding once')
  }

  const torqueOld = new FakeMotionDriver()
  let oldEnabled: MotionCompletion | undefined
  torqueOld.setTorque = (_enabled, callback) => {
    oldEnabled = callback
  }
  const torqueNext = new FakeMotionDriver()
  const torqueReplacement = new MotionController({ driver: torqueOld }, { isPaused: () => false })
  torqueReplacement.lookAt([1, 2, 2])
  torqueReplacement.useDriver(torqueNext)
  torqueReplacement.lookAway()
  oldEnabled?.()
  equal(torqueNext.appliedRotation, null, 'old torque ACK cannot move the new driver')
  torqueReplacement.close()

  const moveOld = new FakeMotionDriver()
  let oldApplied: MotionCompletion | undefined
  moveOld.applyRotation = (_rotation, _time, callback) => {
    oldApplied = callback
  }
  const moveNext = new FakeMotionDriver()
  const moveReplacement = new MotionController({ driver: moveOld }, { isPaused: () => false })
  moveReplacement.lookAt([1, 2, 2])
  moveReplacement.useDriver(moveNext)
  moveReplacement.lookAway()
  oldApplied?.()
  await wait(1100)
  equal(moveNext.torqueStates.length, 0, 'old motion ACK cannot schedule torque release on the new driver')
  equal(moveNext.getRotationCalls, 0, 'idle replacement retains no polling timer')
  moveReplacement.close()

  const ackOld = new FakeMotionDriver()
  const ackNext = new FakeMotionDriver()
  let oldAck: MotionCompletion | undefined
  ackOld.applyRotation = (_rotation, _time, callback) => {
    oldAck = callback
  }
  ackOld.onDetached = () => {
    oldAck?.()
  }
  const ackReplacement = new MotionController({ driver: ackOld }, { isPaused: () => false })
  let ackCount = 0
  let replacementError: unknown
  ackReplacement.setPose(pose, 0.25, (error) => {
    ackCount += 1
    replacementError = error
  })
  ackReplacement.useDriver(ackNext)
  oldAck?.()
  equal(ackCount, 1, 'replacement settles pending commands exactly once')
  assert(replacementError instanceof Error, 'an ACK inside detach cannot report success after invalidation')
  ackReplacement.useDriver(ackNext)
  equal(ackNext.attached, 1, 'selecting the current driver does not create another attachment')
  ackReplacement.close()

  const healthy = new FakeMotionDriver()
  const broken = new FakeMotionDriver()
  const attachError = new Error('attach failed')
  broken.onAttached = () => {
    throw attachError
  }
  const failedReplacement = new MotionController({ driver: healthy }, { isPaused: () => false })
  let observed: unknown
  try {
    failedReplacement.useDriver(broken)
  } catch (error) {
    observed = error
  }
  equal(observed, attachError, 'replacement preserves the attach failure')
  equal(healthy.detached, 1, 'failed replacement has already detached the old driver')
  equal(broken.detached, 1, 'failed attachment is rolled back once')
  failedReplacement.close()
  equal(broken.detached, 1, 'close does not repeat the rollback')
  let rejectedAfterFailure: unknown
  failedReplacement.setTorque(true, (error) => {
    rejectedAfterFailure = error
  })
  assert(rejectedAfterFailure instanceof Error, 'failed replacement leaves the controller closed')
}

async function runTest() {
  trace('=== motion controller test ===\n')

  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })

  equal(driver.attached, 1, 'initial driver should be attached')

  controller.lookAt([1, 2, 2])

  const expectedPitch = -Math.atan2(2, Math.sqrt(1 ** 2 + 2 ** 2))
  equal(driver.torqueStates[0], true, 'lookAt update should enable torque before moving')
  assert(driver.appliedRotation != null, 'lookAt update should apply a face rotation')
  assert(
    Math.abs(driver.appliedRotation.p - expectedPitch) < 0.000001,
    'lookAt update should use xy distance when calculating pitch',
  )
  assert(driver.appliedTime != null && driver.appliedTime >= 0.5, 'lookAt movement should use random motion time')
  assert(driver.appliedTime != null && driver.appliedTime <= 1.0, 'lookAt movement should cap random motion time')

  await wait(1100)
  equal(driver.torqueStates[1], false, 'lookAt movement should release torque after motion time')

  controller.lookAway()
  equal(controller.gazePoint, null, 'lookAway should clear the gaze point')

  const pollingDriver = new FakeMotionDriver()
  const pollingController = new MotionController({ driver: pollingDriver }, { isPaused: () => false })
  await wait(500)
  equal(pollingDriver.getRotationCalls, 0, 'pose polling should stay idle without a gaze point')

  pollingController.lookAt([1, 2, 2])
  equal(pollingDriver.getRotationCalls, 1, 'lookAt should sample pose immediately')
  await wait(100)
  assert(pollingDriver.getRotationCalls > 1, 'lookAt should start timer-driven pose polling')

  pollingController.lookAway()
  await wait(1100)
  const callsAfterMotionSettled = pollingDriver.getRotationCalls
  await wait(500)
  equal(pollingDriver.getRotationCalls, callsAfterMotionSettled, 'pose polling should stop after gaze clears')
  pollingController.close()

  const releaseDriver = new FakeMotionDriver()
  const releaseController = new MotionController({ driver: releaseDriver }, { isPaused: () => false })
  releaseController.lookAt([1, 2, 2])
  equal(releaseController.gazePoint?.[0], 1, 'lookAt should set the gaze point')
  releaseController.lookAt(undefined)
  equal(releaseController.gazePoint, null, 'lookAt(undefined) should release the gaze point')
  await wait(1100)
  const releaseCallsAfterSettled = releaseDriver.getRotationCalls
  await wait(500)
  equal(releaseDriver.getRotationCalls, releaseCallsAfterSettled, 'pose polling should stop after lookAt(undefined)')
  releaseController.close()

  const closingDriver = new FakeMotionDriver()
  const closingController = new MotionController({ driver: closingDriver }, { isPaused: () => false })
  closingController.lookAt([1, 2, 2])
  equal(closingDriver.torqueStates[0], true, 'lookAt should enable torque before close')
  closingController.close()
  closingController.close()
  equal(closingDriver.detached, 1, 'close should detach the driver exactly once')
  const callsAfterClose = closingDriver.getRotationCalls
  await wait(1200)
  equal(closingDriver.torqueStates.length, 1, 'close should cancel the pending torque release timer')
  equal(closingDriver.getRotationCalls, callsAfterClose, 'close should stop pose polling')

  equal(motionDurationSecondsToMilliseconds(0.5), 500, 'seconds should convert to milliseconds')
  equal(motionDurationSecondsToMilliseconds(0.1234), 123, 'millisecond conversion should round to integers')
  equal(motionDurationSecondsToMilliseconds(-1), 0, 'millisecond conversion should clamp negative durations')
  equal(motionDurationSecondsToCentiseconds(0.5), 50, 'seconds should convert to centiseconds')
  equal(motionDurationSecondsToCentiseconds(0.126), 13, 'centisecond conversion should round to integers')
  equal(motionDurationSecondsToCentiseconds(-1), 0, 'centisecond conversion should clamp negative durations')

  const nextDriver = new FakeMotionDriver()
  controller.useDriver(nextDriver)
  equal(driver.detached, 1, 'replacing driver should detach the previous driver')
  equal(nextDriver.attached, 1, 'replacing driver should attach the next driver')

  await waitForCompletion((callback) => controller.setTorque(true, callback))
  equal(nextDriver.torqueStates[0], true, 'setTorque should delegate to the active driver')

  const pose: Pose = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0.2, p: -0.1, r: 0 },
  }
  await waitForCompletion((callback) => controller.setPose(pose, 0.25, callback))
  equal(nextDriver.appliedRotation?.y, 0.2, 'setPose should delegate yaw to the active driver')
  equal(nextDriver.appliedRotation?.p, -0.1, 'setPose should delegate pitch to the active driver')
  equal(nextDriver.appliedTime, 0.25, 'setPose should pass motion time to the active driver')

  controller.close()
  equal(nextDriver.detached, 1, 'close should detach the replacement driver')
  let closedError: unknown
  controller.setPose(pose, 0.25, (error) => {
    closedError = error
  })
  assert(closedError instanceof Error, 'closed commands should fail')

  const delayedDriver = new FakeMotionDriver()
  let lateTorque: MotionCompletion | undefined
  delayedDriver.setTorque = (_torque, callback) => {
    lateTorque = callback
  }
  const delayedController = new MotionController({ driver: delayedDriver }, { isPaused: () => false })
  delayedController.lookAt([1, 2, 2])
  delayedController.close()
  lateTorque?.()
  equal(delayedDriver.appliedRotation, null, 'late torque callbacks must not start motion after close')

  const pendingDriver = new FakeMotionDriver()
  let lateCommand: MotionCompletion | undefined
  pendingDriver.applyRotation = (_rotation, _time, callback) => {
    lateCommand = callback
  }
  const pendingController = new MotionController({ driver: pendingDriver }, { isPaused: () => false })
  let completions = 0
  let cancelled: unknown
  pendingController.setPose(pose, 0.25, (error) => {
    completions += 1
    cancelled = error
  })
  pendingController.close()
  lateCommand?.()
  equal(completions, 1, 'close must complete pending commands once and suppress late success')
  assert(cancelled instanceof Error, 'close must fail unfinished commands')

  await testReplacement(pose)

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`motion controller test failed: ${error}\n`)
  throw error
})
