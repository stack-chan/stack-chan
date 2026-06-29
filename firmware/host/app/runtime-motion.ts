import type { Driver } from 'capabilities'
import { type Pose, Rotation, randomBetween, Vector3 } from 'stackchan-util'
import Timer from 'timer'

const INTERVAL_POSE = 1000 / 10

type RuntimeMotionPose = {
  body: Pose
  eyes: {
    left: Pose
    right: Pose
  }
}

export type RuntimeMotionConstructorParam = {
  driver: Driver
  pose?: RuntimeMotionPose
}

type RuntimeMotionOptions = {
  isPaused: () => boolean
}

function createDefaultPose(): RuntimeMotionPose {
  return {
    body: {
      position: {
        x: 0.0,
        y: 0.0,
        z: 0.0,
      },
      rotation: {
        y: 0.0,
        p: 0.0,
        r: 0.0,
      },
    },
    eyes: {
      left: {
        position: {
          x: 0.03,
          y: 0.009,
          z: 0,
        },
        rotation: {
          r: 0.0,
          p: 0.0,
          y: 0.0,
        },
      },
      right: {
        position: {
          x: 0.03,
          y: -0.009,
          z: 0,
        },
        rotation: {
          r: 0.0,
          p: 0.0,
          y: 0.0,
        },
      },
    },
  }
}

export class StackchanRuntimeMotion {
  #driver: Driver
  #gazePoint: Vector3 | null = null
  #isMoving = false
  #options: RuntimeMotionOptions
  #pose: RuntimeMotionPose
  #updatePoseHandler: Timer
  updating = false

  constructor(params: RuntimeMotionConstructorParam, options: RuntimeMotionOptions) {
    this.#options = options
    this.#pose = params.pose ?? createDefaultPose()
    this.useDriver(params.driver)
    this.#updatePoseHandler = Timer.repeat(this.updatePose.bind(this), INTERVAL_POSE)
    void this.#updatePoseHandler
  }

  get driver(): Driver {
    return this.#driver
  }

  get gazePoint(): Vector3 | null {
    return this.#gazePoint
  }

  get pose() {
    return this.#pose
  }

  useDriver(driver: Driver) {
    if (this.#driver != null) {
      this.#driver.onDetached?.()
    }
    this.#driver = driver
    this.#driver.onAttached?.()
  }

  lookAt(position: Vector3) {
    this.#gazePoint = position
  }

  lookAway() {
    this.#gazePoint = null
  }

  async setPose(pose: Pose, time?: number): Promise<void> {
    return this.#driver.applyRotation(pose.rotation, time)
  }

  async setTorque(torque: boolean): Promise<void> {
    return this.#driver.setTorque(torque)
  }

  async updatePose(_id?: unknown) {
    if (this.updating || this.#options.isPaused()) {
      return
    }
    this.updating = true
    const result = await this.#driver.getRotation()
    if (result.success) {
      this.#pose.body.rotation = result.value
    }

    const gazePoint = this.#gazePoint
    if (!this.#isMoving && gazePoint != null) {
      const relativeGazePoint = Vector3.rotate(gazePoint, {
        r: 0.0,
        y: -this.#pose.body.rotation.y,
        p: -this.#pose.body.rotation.p,
      })
      const { y, p } = Rotation.fromVector3(relativeGazePoint)
      if (y > Math.PI / 6 || y < -Math.PI / 6 || p > Math.PI / 6 || p < -Math.PI / 6) {
        this.#isMoving = true
        const time = randomBetween(0.5, 1.0)
        await this.#driver.setTorque(true)
        await this.#driver.applyRotation(Rotation.fromVector3(gazePoint), time)
        Timer.set(
          async () => {
            await this.#driver.setTorque(false)
            this.#isMoving = false
          },
          time * 1000 + 50,
        )
      }
    }
    this.updating = false
  }
}
