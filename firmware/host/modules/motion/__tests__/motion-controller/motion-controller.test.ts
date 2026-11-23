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

type SetMotionPose = (pose: Pose, time?: number) => Promise<void>

function withTemporaryTorque(controller: MotionController, move: (setPose: SetMotionPose) => Promise<void>) {
  return waitForCompletion((done) =>
    controller.withTemporaryTorque((setPose, finish) => {
      void move((pose, time) => waitForCompletion((applied) => setPose(pose, time, applied))).then(
        () => finish(),
        finish,
      )
    }, done),
  )
}

function deferTorque(driver: FakeMotionDriver, target: boolean) {
  return new Promise<MotionCompletion>((resolve) => {
    const setTorque = driver.setTorque.bind(driver)
    driver.setTorque = (torque, callback) => {
      if (torque !== target || !callback) return setTorque(torque, callback)
      driver.setTorque = setTorque
      setTorque(torque)
      resolve(callback)
    }
  })
}

async function testTemporaryTorqueRelease(pose: Pose) {
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  const released = deferTorque(driver, false)
  let update: SetMotionPose | undefined
  const moving = withTemporaryTorque(controller, async (setPose) => {
    update = setPose
  })
  const finishRelease = await released
  let moves = 0
  await withTemporaryTorque(controller, async () => {
    moves++
  })
  equal(moves, 0, 'A second temporary move must wait for torque release')
  await update?.(pose)
  controller.lookAt([0, 2, 0])
  controller.lookAway()
  equal(driver.appliedRotation, null, 'Old pose callbacks and gaze must stay idle during release')

  const restored = deferTorque(driver, true)
  const enabling = waitForCompletion((callback) => controller.setTorque(true, callback))
  equal(driver.torqueStates.join(','), 'true,false', 'Explicit torque-on must follow the pending torque-off')
  finishRelease()
  const finishRestore = await restored
  await withTemporaryTorque(controller, async () => {
    moves++
  })
  equal(moves, 0, 'Motion stays exclusive until explicit torque restore is acknowledged')
  finishRestore()
  await moving
  await enabling
  equal(driver.torqueStates.join(','), 'true,false,true', 'Release must restore the latest explicit torque request')

  await withTemporaryTorque(controller, async () => {
    moves++
  })
  equal(moves, 1, 'A completed release allows another temporary move')
  equal(driver.torqueStates.join(','), 'true,false,true', 'The next move preserves the explicit torque hold')
  controller.close()
}

async function testSupersededTorqueAcquisition(pose: Pose) {
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  const enabled = deferTorque(driver, true)
  let moves = 0
  const temporary = withTemporaryTorque(controller, async () => {
    moves++
  })
  const finishEnable = await enabled
  await waitForCompletion((callback) => controller.setPose(pose, undefined, callback))
  finishEnable()
  await temporary
  equal(moves, 0, 'A pose that supersedes acquisition must skip the temporary move')
  equal(driver.torqueStates.join(','), 'true,false', 'Superseded acquisition must release its hold')

  const released = deferTorque(driver, false)
  const stopping = withTemporaryTorque(controller, async () => {}).catch((error) => error)
  const finishRelease = await released
  const failure = new Error('torque-off failed')
  finishRelease(failure)
  equal(await stopping, failure, 'Torque release errors reach the caller')
  await withTemporaryTorque(controller, async () => {
    moves++
  })
  equal(moves, 1, 'A failed release still clears the exclusion')
  controller.close()
}

async function testCloseBeforeDriverReplacement() {
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  const enabled = deferTorque(driver, true)
  controller.lookAt([1, 2, 2])
  const finishEnable = await enabled
  controller.close()
  const replacement = new FakeMotionDriver()
  controller.useDriver(replacement)
  finishEnable()
  equal(driver.torqueStates.join(','), 'true,false', 'The detached driver must release its pending torque hold')
  equal(replacement.torqueStates.length, 0, 'The detached driver completion must leave the replacement untouched')
  equal(replacement.appliedRotation, null, 'The detached driver completion must not move the replacement')
}

async function testCloseBeforeTemporaryMotion() {
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  const enabled = deferTorque(driver, true)
  controller.lookAt([1, 2, 2])
  const finishEnable = await enabled
  controller.close()

  let moves = 0
  const move = async () => {
    moves++
  }
  await withTemporaryTorque(controller, move)
  equal(moves, 0, 'Temporary motion must wait for a closed gaze enable')

  const released = deferTorque(driver, false)
  finishEnable()
  const finishRelease = await released
  await withTemporaryTorque(controller, move)
  equal(moves, 0, 'Temporary motion must wait for the gaze torque-off acknowledgment')
  finishRelease()
  await withTemporaryTorque(controller, move)
  equal(moves, 1, 'Temporary motion can start after gaze releases torque')
  equal(driver.torqueStates.join(','), 'true,false,true,false', 'Gaze and temporary motion have separate torque holds')
}

async function testCloseDuringGazeSettle() {
  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  controller.lookAt([1, 2, 2])

  const released = deferTorque(driver, false)
  controller.close()
  const finishRelease = await released
  let moves = 0
  const move = async () => {
    moves++
  }
  await withTemporaryTorque(controller, move)
  equal(moves, 0, 'Temporary motion must wait for the torque-off sent while settling')
  finishRelease()
  await withTemporaryTorque(controller, move)
  equal(moves, 1, 'Temporary motion can start after close during settle releases torque')
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
  equal(closingDriver.torqueStates[1], false, 'close during settle should immediately release torque')
  const callsAfterClose = closingDriver.getRotationCalls
  await wait(1200)
  equal(closingDriver.torqueStates.length, 2, 'close should cancel the pending torque release timer')
  equal(closingDriver.getRotationCalls, callsAfterClose, 'close should stop pose polling')

  const doubleCloseDriver = new FakeMotionDriver()
  const doubleCloseController = new MotionController({ driver: doubleCloseDriver }, { isPaused: () => false })
  const pendingEnable = deferTorque(doubleCloseDriver, true)
  doubleCloseController.lookAt([1, 2, 2])
  const finishPendingEnable = await pendingEnable
  doubleCloseController.close()
  doubleCloseController.close()
  finishPendingEnable()
  equal(
    doubleCloseDriver.torqueStates.join(','),
    'true,false',
    'calling close twice while enabling torque must still release torque when enable completes',
  )

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

  let moves = 0
  const move = async () => {
    moves++
    equal(nextDriver.torqueStates.at(-1), true)
  }
  await withTemporaryTorque(controller, move)
  equal(nextDriver.torqueStates.join(','), 'true', 'A nod preserves torque already held by another feature')
  await waitForCompletion((callback) => controller.setTorque(false, callback))
  await withTemporaryTorque(controller, move)
  equal(moves, 2)
  equal(nextDriver.torqueStates.join(','), 'true,false,true,false', 'A nod releases its own torque hold')

  const pose: Pose = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0.2, p: -0.1, r: 0 },
  }
  await waitForCompletion((callback) => controller.setPose(pose, 0.25, callback))
  equal(nextDriver.appliedRotation?.y, 0.2, 'setPose should delegate yaw to the active driver')
  equal(nextDriver.appliedRotation?.p, -0.1, 'setPose should delegate pitch to the active driver')
  equal(nextDriver.appliedTime, 0.25, 'setPose should pass motion time to the active driver')

  const newerPose: Pose = { ...pose, rotation: { y: 0, p: 0.3, r: 0 } }
  await withTemporaryTorque(controller, async (setPose) => {
    await setPose(pose)
    await waitForCompletion((callback) => controller.setPose(newerPose, undefined, callback))
    await setPose(pose)
  })
  equal(nextDriver.appliedRotation, newerPose.rotation, 'A newer pose supersedes the temporary motion and its restore')
  await testTemporaryTorqueRelease(pose)
  await testSupersededTorqueAcquisition(newerPose)
  await testCloseBeforeDriverReplacement()
  await testCloseBeforeTemporaryMotion()
  await testCloseDuringGazeSettle()

  trace('@@STACKCHAN_TEST:PASS@@\n')
}

runTest().catch((error) => {
  trace('@@STACKCHAN_TEST:FAIL@@\n')
  trace(`motion controller test failed: ${error}\n`)
  throw error
})
