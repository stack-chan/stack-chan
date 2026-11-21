import { M5StackChanServoDriver } from 'm5stackchan-servo-driver'
import {
  type ContinuousYawControl,
  type ContinuousYawDriver,
  type MotionCompletion,
  MotionController,
  type MotionDriver,
  type MotionResultCallback,
  type MotionValueCompletion,
  motionDurationSecondsToCentiseconds,
  motionDurationSecondsToMilliseconds,
} from 'motion-controller'
import { servoFixture } from 'motion-test-servo-fixture'
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

class FakeContinuousYawDriver extends FakeMotionDriver {
  powers: number[] = []
  opened = 0
  startError?: Error
  deferPositionTorque = false
  pendingPosition?: MotionCompletion
  nextPositionRead: ContinuousYawDriver['readRawPosition'] = (done) => done(undefined, 731)
  continuousYaw: ContinuousYawDriver = {
    start: (done) => {
      this.opened += 1
      done(this.startError)
    },
    setPower: (power, done) => {
      this.powers.push(power)
      done()
    },
    readRawPosition: (done) => this.nextPositionRead(done),
    stop: (done) => {
      this.powers.push(0)
      done()
    },
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    if (this.deferPositionTorque) {
      this.torqueStates.push(torque)
      this.pendingPosition = callback
      return
    }
    super.setTorque(torque, callback)
  }
}

function waitForValue<T>(start: (done: MotionValueCompletion<T>) => void): Promise<T | undefined> {
  return new Promise((resolve, reject) =>
    start((error, result) => {
      if (error != null) reject(error)
      else resolve(result)
    }),
  )
}

async function startYaw(controller: MotionController) {
  const yaw = await waitForValue<ContinuousYawControl>((done) => controller.startContinuousYaw(done))
  if (!yaw) throw new Error('Expected a continuous yaw session')
  return {
    setPower: (power: number, timeoutMs: number) => waitForCompletion((done) => yaw.setPower(power, timeoutMs, done)),
    readRawPosition: () => waitForValue<number>((done) => yaw.readRawPosition(done)),
    close: () => waitForCompletion((done) => yaw.close(done)),
  }
}

async function rejects(operation: Promise<unknown>, message: string) {
  let rejected = false
  try {
    await operation
  } catch {
    rejected = true
  }
  assert(rejected, message)
}

async function checkContinuousYaw(pose: Pose) {
  const unsupported = new MotionController({ driver: new FakeMotionDriver() }, { isPaused: () => false })
  equal(unsupported.supportsContinuousYaw, false, 'ordinary drivers should report unsupported continuous yaw')
  equal(
    await waitForValue((done) => unsupported.startContinuousYaw(done)),
    undefined,
    'ordinary drivers should not open a continuous yaw session',
  )

  const driver = new FakeContinuousYawDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  const start = () => startYaw(controller)

  controller.lookAt([1, 2, 2])
  assert(driver.appliedRotation, 'gaze should position the head before continuous yaw')
  const previousRotation = driver.appliedRotation
  const yaw = await start()
  equal(controller.supportsContinuousYaw, true, 'continuous yaw driver should report support')
  equal(driver.torqueStates.at(-1), false, 'acquiring continuous yaw should release existing gaze torque')
  const torqueWrites = driver.torqueStates.length
  equal(await yaw.readRawPosition(), 731, 'continuous yaw should return the raw position')
  await rejects(start(), 'continuous yaw should have one owner')
  await rejects(
    waitForCompletion((done) => controller.setPose(pose, 0, done)),
    'position commands should be rejected during continuous yaw',
  )
  await rejects(
    waitForCompletion((done) => controller.setTorque(false, done)),
    'torque commands should be rejected during continuous yaw',
  )
  controller.lookAt([1, -2, 0])
  await yaw.setPower(-0.4, 1000)
  await wait(650)
  await yaw.setPower(-0.4, 1000)
  await wait(450)
  equal(driver.powers.at(-1), -0.4, 'a fresh power command should extend the deadline')
  equal(driver.torqueStates.length, torqueWrites, 'automatic torque release should stay canceled during continuous yaw')
  equal(driver.appliedRotation, previousRotation, 'gaze should leave the neck alone during continuous yaw')

  await yaw.close()
  equal(driver.powers.at(-1), 0, 'closing continuous yaw should write zero power')
  const writesAfterClose = driver.powers.length
  await yaw.close()
  await rejects(yaw.setPower(1, 1000), 'closed yaw sessions should reject further movement')
  equal(driver.powers.length, writesAfterClose, 'repeated close and stale power should leave the servo stopped')
  equal(controller.gazePoint, null, 'continuous yaw should discard gaze requests')
  equal(driver.appliedRotation, previousRotation, 'stop should leave the servo position alone')
  await waitForCompletion((done) => controller.setPose(pose, 0, done))
  equal(driver.appliedRotation?.y, pose.rotation.y, 'explicit positioning should resume after close')

  const expired = await start()
  await expired.setPower(0.3, 30)
  await wait(80)
  equal(driver.powers.at(-1), 0, 'expired commands should stop the servo')
  await rejects(expired.setPower(0.2, 1000), 'expired sessions should stay closed')

  const failed = await start()
  await failed.setPower(0.4, 1000)
  driver.nextPositionRead = (done) => done(new Error('Simulated communication failure'))
  await rejects(failed.readRawPosition(), 'communication failures should reject the pending read')
  equal(driver.powers.at(-1), 0, 'communication failures should stop the servo')

  let finishRead: ((position: number) => void) | undefined
  const readStarted = new Promise<void>((resolve) => {
    driver.nextPositionRead = (done) => {
      finishRead = (position) => done(undefined, position)
      resolve()
    }
  })
  const shuttingDown = await start()
  await shuttingDown.setPower(0.5, 1000)
  const reading = shuttingDown.readRawPosition()
  await readStarted
  const closed = waitForCompletion((done) => controller.close(done))
  const closedAgain = waitForCompletion((done) => controller.close(done))
  equal(driver.powers.at(-1), 0.5, 'shutdown should wait for the outstanding servo operation')
  finishRead?.(730)
  await rejects(reading, 'closing the controller should invalidate the outstanding read')
  await Promise.all([closed, closedAgain])
  equal(driver.powers.at(-1), 0, 'controller shutdown should stop the servo even during a position read')

  const movingDriver = new FakeContinuousYawDriver()
  movingDriver.deferPositionTorque = true
  const movingController = new MotionController({ driver: movingDriver }, { isPaused: () => false })
  movingController.lookAt([1, 2, 2])
  const takingOver = startYaw(movingController)
  equal(movingDriver.opened, 0, 'continuous yaw should wait for an outstanding position command')
  const finishPosition = movingDriver.pendingPosition
  assert(finishPosition, 'expected an outstanding gaze torque command')
  movingDriver.deferPositionTorque = false
  movingDriver.startError = new Error('Simulated startup failure')
  finishPosition?.()
  await rejects(takingOver, 'a startup error should reject the lease request')
  equal(movingDriver.appliedRotation, null, 'a stale gaze command should skip applying its angle')
  equal(movingDriver.torqueStates.at(-1), false, 'a failed acquisition should release the previous gaze torque')
  await waitForCompletion((done) => movingController.setPose(pose, 0, done))
  equal(movingDriver.appliedRotation?.y, pose.rotation.y, 'a startup failure should release motion ownership')
}

async function checkK151Motion(pose: Pose) {
  const driver = new M5StackChanServoDriver({ servoPower: { type: 'py32' } })
  const controller = new MotionController({ driver }, { isPaused: () => false })
  const registers = new DataView(servoFixture.yaw.buffer)
  const originalLimits = registers.getUint32(9)
  const start = () => startYaw(controller)

  const session = await start()
  equal(registers.getUint32(9), 0, 'K151 should switch yaw into motor mode')
  equal(registers.getUint8(48), 1, 'K151 mode changes should leave the EEPROM write lock set')
  equal(registers.getUint16(44), 0, 'K151 should enter continuous yaw at zero output')
  equal(await session.readRawPosition(), 731, 'K151 should report the servo position register verbatim')
  await session.setPower(-0.5, 1000)
  equal(registers.getUint16(44), 0x600, 'K151 should encode reverse PWM with the direction bit')
  await session.close()
  equal(registers.getUint16(44), 0, 'K151 should send PWM zero on stop')
  equal(servoFixture.yawPositionWrites, 0, 'K151 should never send a position target on stop')
  equal(servoFixture.poweredModeRestores, 0, 'K151 should disable torque before restoring positional mode')
  equal(registers.getUint32(9), originalLimits, 'K151 should restore the original servo limits')
  await waitForCompletion((done) => controller.setPose(pose, 0, done))
  equal(servoFixture.yawPositionWrites, 1, 'K151 should accept a new position target after stop')

  const overloaded = await start()
  servoFixture.faultOnNextPowerWrite = true
  await rejects(overloaded.setPower(0.5, 1000), 'K151 should reject an overload status response')
  equal(registers.getUint16(44), 0, 'K151 should stop after a servo reports an overload')
  equal(registers.getUint32(9), originalLimits, 'K151 should restore position mode after a servo reports an overload')

  const lost = await start()
  await lost.setPower(0.5, 1000)
  servoFixture.wireDisconnected = true
  await rejects(lost.close(), 'K151 should reject when stop cannot be confirmed over UART')
  equal(servoFixture.powerEnabled, false, 'K151 should cut the servo supply when UART stop fails')
  await rejects(
    waitForCompletion((done) => controller.setPose(pose, 0, done)),
    'K151 should reject a position target after a failed stop',
  )
  await waitForCompletion((done) => controller.close(done))
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

  await checkContinuousYaw(pose)
  await checkK151Motion(pose)

  trace('@@STACKCHAN_TEST:PASS@@\n')
}

runTest().catch((error) => {
  trace('@@STACKCHAN_TEST:FAIL@@\n')
  trace(`motion controller test failed: ${error}\n`)
  throw error
})
