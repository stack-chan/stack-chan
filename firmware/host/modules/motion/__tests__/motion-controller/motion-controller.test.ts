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

async function runTest() {
  trace('=== motion controller test ===\n')

  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  controller.close()

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

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`motion controller test failed: ${error}\n`)
  throw error
})
