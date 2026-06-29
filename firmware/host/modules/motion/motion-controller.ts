import { type Maybe, type Pose, type Rotation as RotationType, randomBetween, type Vector3 } from 'stackchan-util'
import Timer from 'timer'

const INTERVAL_POSE = 1000 / 10
const GAZE_THRESHOLD = Math.PI / 6

export type MotionCompletion = (error?: unknown) => void
export type MotionResultCallback<T> = (result: T) => void

export type MotionDriver = {
  applyRotation: (ori: RotationType, time?: number, callback?: MotionCompletion) => void
  getRotation: (callback: MotionResultCallback<Maybe<RotationType>>) => void
  setTorque: (torque: boolean, callback?: MotionCompletion) => void
  onAttached?: () => void
  onDetached?: () => void
}

export type MotionControllerPose = {
  body: Pose
  eyes: {
    left: Pose
    right: Pose
  }
}

export type MotionControllerConstructorParam = {
  driver: MotionDriver
  pose?: MotionControllerPose
}

type MotionControllerOptions = {
  isPaused: () => boolean
}

function createDefaultPose(): MotionControllerPose {
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

function writeRotationFromVector3(target: RotationType, vector: Vector3): void {
  writeRotationFromComponents(target, vector[0], vector[1], vector[2])
}

function writeRotationFromComponents(target: RotationType, x: number, y: number, z: number): void {
  target.y = Math.atan2(y, x)
  target.p = -Math.atan2(z, Math.sqrt(x ** 2 + x ** 2))
  target.r = 0
}

function writeRelativeGazeRotation(target: RotationType, gazePoint: Vector3, bodyRotation: RotationType): void {
  const x = gazePoint[0]
  const y = gazePoint[1]
  const z = gazePoint[2]
  const inverseYaw = -bodyRotation.y
  const cosY = Math.cos(inverseYaw)
  const sinY = Math.sin(inverseYaw)
  const yawX = x * cosY - y * sinY
  const yawY = x * sinY + y * cosY
  const inversePitch = -bodyRotation.p
  const cosP = Math.cos(inversePitch)
  const sinP = Math.sin(inversePitch)
  const relativeX = yawX * cosP - z * sinP
  const relativeY = yawY
  const relativeZ = yawX * sinP + z * cosP
  writeRotationFromComponents(target, relativeX, relativeY, relativeZ)
}

export class MotionController {
  #driver: MotionDriver
  #gazePoint: Vector3 | null = null
  #isMoving = false
  #nextRotation: RotationType = { y: 0, p: 0, r: 0 }
  #options: MotionControllerOptions
  #pendingMotionTime = 0
  #pose: MotionControllerPose
  #relativeGazeRotation: RotationType = { y: 0, p: 0, r: 0 }
  #updatePoseHandler: ReturnType<typeof Timer.repeat>
  updating = false

  constructor(params: MotionControllerConstructorParam, options: MotionControllerOptions) {
    this.#options = options
    this.#pose = params.pose ?? createDefaultPose()
    this.useDriver(params.driver)
    this.#updatePoseHandler = Timer.repeat(this.updatePose.bind(this), INTERVAL_POSE)
    void this.#updatePoseHandler
  }

  get driver(): MotionDriver {
    return this.#driver
  }

  get gazePoint(): Vector3 | null {
    return this.#gazePoint
  }

  get pose() {
    return this.#pose
  }

  close(): void {
    Timer.clear(this.#updatePoseHandler)
  }

  useDriver(driver: MotionDriver) {
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

  setPose(pose: Pose, time?: number, callback?: MotionCompletion): void {
    this.#driver.applyRotation(pose.rotation, time, callback)
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    this.#driver.setTorque(torque, callback)
  }

  updatePose(_id?: unknown): void {
    if (this.updating || this.#options.isPaused()) {
      return
    }
    this.updating = true
    try {
      this.#driver.getRotation(this.#handleRotation)
    } catch (error) {
      trace(`[MotionController] get rotation failed: ${String(error)}\n`)
      this.updating = false
    }
  }

  #handleRotation: MotionResultCallback<Maybe<RotationType>> = (result) => {
    let waitingForMotion = false
    try {
      if (result.success) {
        const bodyRotation = this.#pose.body.rotation
        bodyRotation.y = result.value.y
        bodyRotation.p = result.value.p
        bodyRotation.r = result.value.r
      }

      const gazePoint = this.#gazePoint
      if (!this.#isMoving && gazePoint != null) {
        writeRelativeGazeRotation(this.#relativeGazeRotation, gazePoint, this.#pose.body.rotation)
        const y = this.#relativeGazeRotation.y
        const p = this.#relativeGazeRotation.p
        if (y > GAZE_THRESHOLD || y < -GAZE_THRESHOLD || p > GAZE_THRESHOLD || p < -GAZE_THRESHOLD) {
          this.#isMoving = true
          waitingForMotion = true
          this.#pendingMotionTime = randomBetween(0.5, 1.0)
          writeRotationFromVector3(this.#nextRotation, gazePoint)
          try {
            this.#driver.setTorque(true, this.#handleTorqueEnabled)
          } catch (error) {
            trace(`[MotionController] set torque failed: ${String(error)}\n`)
            this.#isMoving = false
            waitingForMotion = false
          }
        }
      }
    } finally {
      if (!waitingForMotion) {
        this.updating = false
      }
    }
  }

  #handleTorqueEnabled: MotionCompletion = (torqueError) => {
    if (torqueError) {
      trace(`[MotionController] set torque failed: ${String(torqueError)}\n`)
      this.#isMoving = false
      this.updating = false
      return
    }
    try {
      this.#driver.applyRotation(this.#nextRotation, this.#pendingMotionTime, this.#handleMotionApplied)
    } catch (error) {
      trace(`[MotionController] apply rotation failed: ${String(error)}\n`)
      this.#isMoving = false
      this.updating = false
    }
  }

  #handleMotionApplied: MotionCompletion = (moveError) => {
    if (moveError) {
      trace(`[MotionController] apply rotation failed: ${String(moveError)}\n`)
      this.#isMoving = false
    } else {
      try {
        Timer.set(this.#releaseTorque, this.#pendingMotionTime * 1000 + 50)
      } catch (error) {
        trace(`[MotionController] release torque failed: ${String(error)}\n`)
        this.#isMoving = false
      }
    }
    this.updating = false
  }

  #releaseTorque = () => {
    try {
      this.#driver.setTorque(false, this.#handleTorqueReleased)
    } catch (error) {
      trace(`[MotionController] release torque failed: ${String(error)}\n`)
      this.#isMoving = false
    }
  }

  #handleTorqueReleased: MotionCompletion = (releaseError) => {
    if (releaseError) {
      trace(`[MotionController] release torque failed: ${String(releaseError)}\n`)
    }
    this.#isMoving = false
  }
}
