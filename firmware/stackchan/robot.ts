import Timer from 'timer'
import type { Content } from 'piu/MC'
const TIMEOUT = 2000
const R = 0.03

type Pose = {
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

function defaultEyes(): Eye[] {
  return [{
    position: {
      x: 0.03,
      y: 0.009,
      z: 0,
    }
  }, {
    position: {
      x: 0.03,
      y: -0.009,
      z: 0,
    }
  }]
}

function getYawPitchFromVector3(vector3: Vector3) {
  const yaw = Math.atan2(vector3.y, vector3.x)
  const pitch = Math.atan2(vector3.z, Math.sqrt(vector3.x * vector3.x + vector3.y * vector3.y))
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
  position: Vector3,
  onGazeChange?: (yaw: number, pitch: number) => unknown,
}

export class Robot {
  onSaccade: (saccade: { x: number; y: number }) => void
  _target: Target
  _pose: Pose
  _eyes: Eye[]
  constructor(params: {
    eyes: Eye[]
  }
  ) {
    this._pose = {
      yaw: 0.0,
      pitch: 0.0,
      roll: 0.0,
    }
    this._eyes = []
    for (const eye of params.eyes) {
      this._eyes.push(eye)
    }
  }
  async lookAt(target: Vector3) {
  }
  onPoseChange(pose: Pose) {
    this._pose = pose
    this.control()
  }
  onTargetChange (targetPosition: Vector3) {
    this.control()
  }
  follow(target: Target) {
    this._target = target
    this._target.onChange = this.onTargetChange.bind(this)
  }
  unfollow() {
    this._target.onChange = null
    this._target = staticTarget
  }
  control() {
    // 注視点の計算
    const { yaw, pitch } = this._pose
    const v = rotateVector3ByYawAndPitch(this._target, yaw, pitch)
    for (const eye of this._eyes) {
      const relative = sub(v, eye.position)
      const { yaw, pitch } = getYawPitchFromVector3(relative)
      if (eye.onGazeChange) {
        eye.onGazeChange(yaw, pitch)
      }
    }
    // サッカードを反映する
    // 各目毎に角度を計算する
  }
}
