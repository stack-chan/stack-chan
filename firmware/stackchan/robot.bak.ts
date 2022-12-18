import Timer from 'timer'
import type { Content } from 'piu/MC'
import config from 'mc/config'
import { Emotion } from 'avatar'
import TTS_REMOTE from 'tts-remote'
import TTS_LOCAL from 'tts-local'
const TIMEOUT = 2000
const R = 0.03

export type Pose = {
  pitch: number // radian
  yaw: number // radian
  roll: number // radian
}

export type Vector3 = {
  x: number
  y: number
  z: number
}

function add(v1: Vector3, v2: Vector3) {
  return {
    x: v1.x + v2.x,
    y: v1.y + v2.y,
    z: v1.z + v2.z,
  }
}

function sub(v1: Vector3, v2: Vector3) {
  return {
    x: v1.x - v2.x,
    y: v1.y - v2.y,
    z: v1.z - v2.z,
  }
}

function randomBetween(low: number, high: number): number {
  return Math.random() * (high - low) + low
}

export class Target {
  _x: number
  _y: number
  _z: number
  _handler: ReturnType<typeof Timer.set>
  onChange?: (position: Vector3) => unknown
  constructor(x, y, z) {
    this._x = x
    this._y = y
    this._z = z
    this.onChange = null
  }
  get x() {
    return this._x
  }
  set x(x: number) {
    if (this._x == x) {
      return
    }
    this._x = x
    if (this._handler == null) {
      this._handler = Timer.set(this.trigger.bind(this), 0)
    }
  }
  get y() {
    return this._y
  }
  set y(y: number) {
    if (this._y == y) {
      return
    }
    this._y = y
    if (this._handler == null) {
      this._handler = Timer.set(this.trigger.bind(this), 0)
    }
  }
  get z() {
    return this._z
  }
  set z(z: number) {
    if (this._z == z) {
      return
    }
    this._z = z
    if (this._handler == null) {
      this._handler = Timer.set(this.trigger.bind(this), 0)
    }
  }
  trigger() {
    const value = {
      x: this._x,
      y: this._y,
      z: this._z,
    }
    if (this.onChange != null) {
      this.onChange(value)
    }
    this._handler = null
  }
}

const staticTarget = new Target(0.1, 0, 0)

export function defaultEyes(): Eye[] {
  return [
    {
      name: 'leftEye',
      position: {
        x: 0.03,
        y: 0.009,
        z: 0,
      },
    },
    {
      name: 'rightEye',
      position: {
        x: 0.03,
        y: -0.009,
        z: 0,
      },
    },
  ]
}

function getYawPitchFromVector3(vector3: Vector3) {
  // right-handed coordinate
  const yaw = Math.atan2(vector3.y, vector3.x)
  const pitch = - Math.atan2(vector3.z, Math.sqrt(vector3.x * vector3.x + vector3.y * vector3.y))
  return {
    yaw,
    pitch,
  }
}

/**
 * @param {string} name
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} yaw
 * @param {number} pitch
 */
function rotateVector3ByYawAndPitch(v: Vector3, yaw: number, pitch: number) {
  const x = v.x
  const y = v.y
  const z = v.z
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  const yawRotated = {
    x: x * cosY - y * sinY,
    y: x * sinY + y * cosY,
    z: z,
  }
  const cosP = Math.cos(pitch)
  const sinP = Math.sin(pitch)
  const pitchRotated = {
    x: yawRotated.x * cosP - yawRotated.z * sinP,
    y: yawRotated.y,
    z: yawRotated.x * sinP + yawRotated.z * cosP,
  }
  return pitchRotated
}

type Eye = {
  name: string
  position: Vector3
}

// type Emotion =
//   | 'angry'
//   | 'disgusted'
//   | 'fearful'
//   | 'happy'
//   | 'sad'
//   | 'surprised'
//   | 'neutral'

type MouthState = {
  open: number
}

type EyeState = {
  name: string
  gaze: {
    yaw: number
    pitch: number
  }
}

type FaceContext = {
  eyes: EyeState[]
  emotion: Emotion
  mouth: MouthState
}

type Renderer = {
  render: (faceContext: FaceContext) => unknown
}

type Driver = {
  applyPose: (pose: Pose) => unknown
  onPoseChanged: (pose: Pose) => unknown
}

function toRadian(deg: number) {
  return (deg * Math.PI) / 180
}

function toDegree(rad: number) {
  return (rad * 180) / Math.PI
}

type Saccade = {
  yaw: number
  pitch: number
}

export class Robot {
  _target: Target
  _pose: Pose
  _eyes: Eye[]
  _driver: Driver
  _isMoving: boolean
  _saccade: Saccade
  _saccadeGain: number
  _saccadeInterval: number
  _renderer: Renderer
  constructor(params: { driver: Driver; renderer: Renderer; eyes: Eye[] }) {
    this._renderer = params.renderer
    this._isMoving = false
    this._pose = {
      yaw: 0.0,
      pitch: 0.0,
      roll: 0.0,
    }
    this._eyes = []
    for (const eye of params.eyes) {
      this._eyes.push(eye)
    }
    this._saccade = {
      yaw: 0.0,
      pitch: 0.0,
    }
    this._saccadeGain = 1.0
    this._saccadeInterval = 300
    this._driver = params.driver
    this._driver.onPoseChanged = this.onPoseChange.bind(this)
    Timer.set(this.saccadeLoop.bind(this), randomBetween(this._saccadeInterval, this._saccadeInterval * 5))
  }
  async speak(string) {
    const promise = config?.tts?.driver == 'remote' ? TTS_REMOTE.speak(string) : TTS_LOCAL.speak(string)
    promise.then(
      (bytes) => {
        return bytes
      },
      (error) => {
        return error
      }
    )
    return promise
  }
  async lookAt(target: Vector3) {
    /* noop */
  }
  saccadeLoop() {
    const gain = this._saccadeGain
    const base = Math.PI / 18
    const saccade = {
      yaw: randomBetween(-base * gain, base * gain),
      pitch: randomBetween(-base * gain, base * gain),
    }
    this.onSaccade(saccade)
    Timer.set(this.saccadeLoop.bind(this), randomBetween(this._saccadeInterval, this._saccadeInterval * 5))
  }
  onSaccade(saccade: { yaw: number; pitch: number }) {
    this._saccade = saccade
    this.control()
  }
  onPoseChange(pose: Pose) {
    // trace(`onPoseChange__\t`)
    this._pose = pose
    this.control()
  }
  onTargetChange(targetPosition: Vector3) {
    // trace(`onTargetChange__\t`)
    this.control()
  }
  follow(target?: Target) {
    if (target == null) {
      // trace('no target specified\n')
      return
    }
    this._target = target
    this._target.onChange = this.onTargetChange.bind(this)
  }
  unfollow() {
    this._target.onChange = null
    this._target = staticTarget
  }
  control() {
    // trace(`control___this._isMoving: ${this._isMoving}\n`)
    // 注視点の計算
    const { yaw, pitch } = this._pose
    // trace(`yaw: ${toDegree(yaw)}, pitch: ${toDegree(pitch)}\n`)

    if (this._target == null) {
      return
    }
    const v = rotateVector3ByYawAndPitch(this._target, -yaw, -pitch)
    const face: FaceContext = {
      emotion: Emotion.NEUTRAL,
      eyes: [] as { name: string; gaze: { yaw: number; pitch: number } }[],
      mouth: {
        open: 1.0,
      },
    }
    for (const eye of this._eyes) {
      const relative = sub(v, eye.position)
      const { yaw, pitch } = getYawPitchFromVector3(relative)
      face.eyes.push({
        name: eye.name,
        gaze: {
          yaw,
          pitch,
        },
      })
    }
    this._renderer.render(face)
    if (!this._isMoving) {
      const { yaw: poseYaw, pitch: posePitch } = getYawPitchFromVector3(v)
      // trace(`target angle: (${toDegree(yaw)}, ${toDegree(pitch)})\n`)
      if (poseYaw > Math.PI / 6 || poseYaw < -Math.PI / 6 || posePitch > Math.PI / 6 || posePitch < -Math.PI / 6) {
        const tv = {
          x: this._target.x,
          y: this._target.y,
          z: this._target.z,
        }
        const { yaw, pitch } = getYawPitchFromVector3(tv)
        this._isMoving = true
        Timer.set(() => {
          // trace(`this._isMoving: ${this._isMoving} then headding to (${toDegree(yaw)}, ${toDegree(pitch)})\n`)
          this._driver.applyPose({
            yaw,
            pitch,
            roll: 0,
          })
          Timer.set(() => {
            this._isMoving = false
          }, 500)
        }, 50)
      }
    }
  }
}
