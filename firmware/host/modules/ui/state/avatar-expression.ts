import { clampMouthOpenRatio, type MouthOpenRatio } from 'domain-values'
import {
  type ColorRGB,
  colorEquals,
  createFaceState,
  type Emotion,
  type FaceEyeKey,
  type FaceState,
  type FaceThemeKey,
  resetFaceState,
  setColorRGB,
} from 'face-state'
import type { Pose, Position, Rotation, Vector3 } from 'stackchan-util'

export const ExpressionDirty = Object.freeze({
  None: 0,
  Mouth: 1 << 0,
  Eyes: 1 << 1,
  Gaze: 1 << 2,
  Emotion: 1 << 3,
  Theme: 1 << 4,
  All: (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4),
} as const)

export type ExpressionDirtyMask = number

export type AvatarGazePose = Readonly<{
  body: Readonly<Pose>
  eyes: Readonly<{
    left: Readonly<Pose>
    right: Readonly<Pose>
  }>
}>

function clampUnit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function writeBodyRelativeVector3(target: Vector3, point: Readonly<Vector3>, bodyRotation: Readonly<Rotation>): void {
  const x = point[0]
  const y = point[1]
  const z = point[2]
  const inverseYaw = -bodyRotation.y
  const cosY = Math.cos(inverseYaw)
  const sinY = Math.sin(inverseYaw)
  const yawX = x * cosY - y * sinY
  const yawY = x * sinY + y * cosY
  const inversePitch = -bodyRotation.p
  const cosP = Math.cos(inversePitch)
  const sinP = Math.sin(inversePitch)
  target[0] = yawX * cosP - z * sinP
  target[1] = yawY
  target[2] = yawX * sinP + z * cosP
}

function writePositionRelativeVector3(target: Vector3, point: Readonly<Vector3>, position: Readonly<Position>): void {
  target[0] = point[0] - position.x
  target[1] = point[1] - position.y
  target[2] = point[2] - position.z
}

function writeRotationFromVector3(target: Rotation, vector: Readonly<Vector3>): void {
  const x = vector[0]
  const y = vector[1]
  const z = vector[2]
  target.y = Math.atan2(y, x)
  target.p = -Math.atan2(z, Math.sqrt(x * x + y * y))
  target.r = 0
}

export class AvatarExpression {
  #faceState: FaceState = createFaceState()
  #dirty: ExpressionDirtyMask = ExpressionDirty.All
  #relativeGazePoint: Vector3 = [0, 0, 0]
  #eyeGazePoint: Vector3 = [0, 0, 0]
  #eyeGazeRotation: Rotation = { y: 0, p: 0, r: 0 }
  #previousColor: ColorRGB = { r: 0, g: 0, b: 0 }

  get faceState(): FaceState {
    return this.#faceState
  }

  get dirtyFlags(): ExpressionDirtyMask {
    return this.#dirty
  }

  get isDirty(): boolean {
    return this.#dirty !== ExpressionDirty.None
  }

  setMouthOpen(value: number | MouthOpenRatio): boolean {
    const next = clampMouthOpenRatio(value)
    if (this.#faceState.mouth.open === next) return false
    this.#faceState.mouth.open = next
    this.#dirty |= ExpressionDirty.Mouth
    return true
  }

  setEyeOpen(key: FaceEyeKey, value: number): boolean {
    const next = clampUnit(value)
    if (this.#faceState.eyes[key].open === next) return false
    this.#faceState.eyes[key].open = next
    this.#dirty |= ExpressionDirty.Eyes
    return true
  }

  setEmotion(emotion: Emotion): boolean {
    if (this.#faceState.emotion === emotion) return false
    this.#faceState.emotion = emotion
    this.#dirty |= ExpressionDirty.Emotion
    return true
  }

  setColor(key: FaceThemeKey, r: number, g: number, b: number): boolean {
    const target = this.#faceState.theme[key]
    this.#previousColor.r = target.r
    this.#previousColor.g = target.g
    this.#previousColor.b = target.b
    setColorRGB(target, r, g, b)
    if (colorEquals(this.#previousColor, target)) return false
    this.#dirty |= ExpressionDirty.Theme
    return true
  }

  setGaze(key: FaceEyeKey, gazeX: number, gazeY: number): boolean {
    const nextX = Number.isFinite(gazeX) ? gazeX : 0
    const nextY = Number.isFinite(gazeY) ? gazeY : 0
    const eye = this.#faceState.eyes[key]
    if (eye.gazeX === nextX && eye.gazeY === nextY) return false
    eye.gazeX = nextX
    eye.gazeY = nextY
    this.#dirty |= ExpressionDirty.Gaze
    return true
  }

  projectGaze(gazePoint: Readonly<Vector3> | null | undefined, pose: AvatarGazePose): boolean {
    if (gazePoint == null) return false
    writeBodyRelativeVector3(this.#relativeGazePoint, gazePoint, pose.body.rotation)
    const leftChanged = this.#projectEyeGaze('left', pose.eyes.left.position)
    const rightChanged = this.#projectEyeGaze('right', pose.eyes.right.position)
    return leftChanged || rightChanged
  }

  consumeDirtyFlags(): ExpressionDirtyMask {
    const flags = this.#dirty
    this.#dirty = ExpressionDirty.None
    return flags
  }

  reset(): void {
    resetFaceState(this.#faceState)
    this.#dirty = ExpressionDirty.All
  }

  #projectEyeGaze(key: FaceEyeKey, position: Readonly<Position>): boolean {
    writePositionRelativeVector3(this.#eyeGazePoint, this.#relativeGazePoint, position)
    writeRotationFromVector3(this.#eyeGazeRotation, this.#eyeGazePoint)
    const nextX = Math.cos(this.#eyeGazeRotation.y)
    const nextY = Math.cos(this.#eyeGazeRotation.p)
    const eye = this.#faceState.eyes[key]
    if (eye.gazeX === nextX && eye.gazeY === nextY) return false
    eye.gazeX = nextX
    eye.gazeY = nextY
    this.#dirty |= ExpressionDirty.Gaze
    return true
  }
}
