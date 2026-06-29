import { type Maybe, type Pose, Rotation, type Rotation as RotationType, randomBetween, Vector3 } from 'stackchan-util'
import Timer from 'timer'

const INTERVAL_POSE = 1000 / 10

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

export class MotionController {
  #driver: MotionDriver
  #gazePoint: Vector3 | null = null
  #isMoving = false
  #options: MotionControllerOptions
  #pose: MotionControllerPose
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
      this.#driver.getRotation((result) => {
        let waitingForMotion = false
        try {
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
              waitingForMotion = true
              const time = randomBetween(0.5, 1.0)
              try {
                this.#driver.setTorque(true, (torqueError) => {
                  if (torqueError) {
                    trace(`[MotionController] set torque failed: ${String(torqueError)}\n`)
                    this.#isMoving = false
                    this.updating = false
                    return
                  }
                  try {
                    this.#driver.applyRotation(Rotation.fromVector3(gazePoint), time, (moveError) => {
                      if (moveError) {
                        trace(`[MotionController] apply rotation failed: ${String(moveError)}\n`)
                        this.#isMoving = false
                      } else {
                        Timer.set(
                          () => {
                            try {
                              this.#driver.setTorque(false, () => {
                                this.#isMoving = false
                              })
                            } catch (error) {
                              trace(`[MotionController] release torque failed: ${String(error)}\n`)
                              this.#isMoving = false
                            }
                          },
                          time * 1000 + 50,
                        )
                      }
                      this.updating = false
                    })
                  } catch (error) {
                    trace(`[MotionController] apply rotation failed: ${String(error)}\n`)
                    this.#isMoving = false
                    this.updating = false
                  }
                })
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
      })
    } catch (error) {
      trace(`[MotionController] get rotation failed: ${String(error)}\n`)
      this.updating = false
    }
  }
}
