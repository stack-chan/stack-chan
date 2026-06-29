import { MotionController, type MotionDriver } from 'motion-controller'
import type { Maybe, Pose, Rotation } from 'stackchan-util'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    Timer.set(() => resolve(), ms)
  })
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

async function runTest() {
  trace('=== motion controller test ===\n')

  const driver = new FakeMotionDriver()
  const controller = new MotionController({ driver }, { isPaused: () => false })
  controller.close()

  equal(driver.attached, 1, 'initial driver should be attached')

  controller.lookAt([1, 1, 0])
  await controller.updatePose()

  equal(driver.torqueStates[0], true, 'lookAt update should enable torque before moving')
  assert(driver.appliedRotation != null, 'lookAt update should apply a face rotation')
  assert(driver.appliedTime != null && driver.appliedTime >= 0.5, 'lookAt movement should use random motion time')
  assert(driver.appliedTime != null && driver.appliedTime <= 1.0, 'lookAt movement should cap random motion time')

  await wait(1100)
  equal(driver.torqueStates[1], false, 'lookAt movement should release torque after motion time')

  controller.lookAway()
  equal(controller.gazePoint, null, 'lookAway should clear the gaze point')

  const nextDriver = new FakeMotionDriver()
  controller.useDriver(nextDriver)
  equal(driver.detached, 1, 'replacing driver should detach the previous driver')
  equal(nextDriver.attached, 1, 'replacing driver should attach the next driver')

  await controller.setTorque(true)
  equal(nextDriver.torqueStates[0], true, 'setTorque should delegate to the active driver')

  const pose: Pose = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0.2, p: -0.1, r: 0 },
  }
  await controller.setPose(pose, 0.25)
  equal(nextDriver.appliedRotation?.y, 0.2, 'setPose should delegate yaw to the active driver')
  equal(nextDriver.appliedRotation?.p, -0.1, 'setPose should delegate pitch to the active driver')
  equal(nextDriver.appliedTime, 0.25, 'setPose should pass motion time to the active driver')

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`motion controller test failed: ${error}\n`)
  throw error
})
