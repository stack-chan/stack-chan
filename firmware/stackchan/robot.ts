import Timer from 'timer'
import { Vector3, Pose, Rotation, Maybe, noop, randomBetween } from 'stackchan-util'
import { type FaceContext, type Emotion, defaultFaceContext } from 'face-renderer'
import structuredClone from 'structuredClone'
import Digital from 'embedded:io/digital'

const INTERVAL_FACE = 1000 / 30
const INTERVAL_POSE = 1000 / 10

export type Driver = {
  applyRotation: (ori: Rotation, time?: number) => Promise<void>
  getRotation: () => Promise<Maybe<Rotation>>
  setTorque?: (torque: boolean) => Promise<void>
}

export type TTS = {
  stream: (text: string) => Promise<void>
  onPlayed: (volume: number) => void
  onDone: () => void
}

export type Renderer = {
  update: (interval: number, faceContext: FaceContext) => void
}

export type Button = {
  onChanged: (this: Digital) => void
}

const buttonNames = ['a', 'b', 'c'] as const
type ButtonName = typeof buttonNames[number]

type RobotConstructorParam = {
  driver: Driver
  renderer: Renderer
  tts: TTS
  button: { [key in ButtonName]: Button }
  pose?: {
    body: Pose
    eyes: {
      left: Pose
      right: Pose
    }
  }
}

export class Robot {
  _gazePoint: Vector3
  _pose: {
    body: Pose
    eyes: {
      left: Pose
      right: Pose
    }
  }
  // _overrideContext: Partial<FaceContext>,
  _power: number
  _tts: TTS
  _driver: Driver
  _button: { [key in ButtonName]: Button }
  _isMoving: boolean
  _renderer: Renderer
  _updateFaceHandler: Timer
  _updatePoseHandler: Timer
  constructor(params: RobotConstructorParam) {
    this.useRenderer(params.renderer)
    this.useDriver(params.driver)
    this.useTTS(params.tts)
    this._isMoving = false
    this._power = 0
    this._button = params.button
    this._pose = params.pose ?? {
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
    this._updatePoseHandler = Timer.repeat(this.updatePose.bind(this), INTERVAL_POSE)
    this._updateFaceHandler = Timer.repeat(this.updateFace.bind(this), INTERVAL_FACE)
  }

  /**
   * Setters
   */
  useTTS(tts: TTS) {
    if (this._tts != null) {
      this._tts.onDone = noop
      this._tts.onPlayed = noop
    }
    this._tts = tts
    this._tts.onPlayed = (volume: number) => {
      this._power = volume
    }
    this._tts.onDone = () => {
      this._power = 0
    }
  }
  useRenderer(renderer: Renderer) {
    this._renderer = renderer
  }
  useDriver(driver: Driver) {
    this._driver = driver
  }

  get button() {
    return this._button
  }

  async say(text: string): Promise<Maybe<string>> {
    await this._tts.stream(text).catch((reason) => {
      return {
        success: false,
        message: reason,
      }
    })
    return {
      success: true,
      value: text,
    }
  }

  lookAt(position: Vector3) {
    this._gazePoint = position
  }
  lookAway() {
    this._gazePoint = null
  }

  /**
   * @experimetal
   */
  async setPose(pose: Pose, time?: number): Promise<void> {
    return this._driver.applyRotation(pose.rotation, time)
  }
  async setTorque(torque: boolean): Promise<void> {
    return this._driver.setTorque?.(torque)
  }
  setEmotion(emotion: Emotion) {
    // TBD
  }
  updateFace() {
    const face = structuredClone(defaultFaceContext)
    if (this._power != 0) {
      face.mouth.open = Math.min(this._power / 2000, 1.0)
    }
    if (this._gazePoint != null) {
      const relativeGazePoint = Vector3.rotate(this._gazePoint, {
        r: 0.0,
        y: -this._pose.body.rotation.y,
        p: -this._pose.body.rotation.p,
      })
      for (let key of ['left', 'right'] as const) {
        const pos = this._pose.eyes[key].position
        const relative = Vector3.sub(relativeGazePoint, [pos.x, pos.y, pos.z])
        const { y, p } = Rotation.fromVector3(relative)
        face.eyes[key] = {
          ...face.eyes[key],
          gazeX: Math.cos(y),
          gazeY: Math.cos(p),
        }
      }
    }
    this._renderer.update(INTERVAL_FACE, face)
  }
  async updatePose() {
    const result = await this._driver.getRotation()
    if (result.success) {
      this._pose.body.rotation = result.value
    }

    if (!this._isMoving && this._gazePoint != null) {
      const relativeGazePoint = Vector3.rotate(this._gazePoint, {
        r: 0.0,
        y: -this._pose.body.rotation.y,
        p: -this._pose.body.rotation.p,
      })
      const { y, p } = Rotation.fromVector3(relativeGazePoint)
      if (y > Math.PI / 6 || y < -Math.PI / 6 || p > Math.PI / 6 || p < -Math.PI / 6) {
        this._isMoving = true
        const time = randomBetween(0.5, 1.0)
        await this._driver.applyRotation(Rotation.fromVector3(this._gazePoint), time)
        Timer.set(async () => {
          await this._driver.setTorque(false)
          this._isMoving = false
        }, time * 1000 + 50)
      }
    }
  }
}
