import {
  type Maybe,
  type Pose,
  type Rotation,
  randomBetween,
  type Vector3,
  writeBodyRelativeVector3,
  writeRotationFromVector3,
} from 'stackchan-util'

export const GAZE_THRESHOLD = Math.PI / 6
export const SETTLE_MARGIN_MS = 50
export const DEFAULT_MIN_MOTION_SECONDS = 0.5
export const DEFAULT_MAX_MOTION_SECONDS = 1.0

export const MotionPhase = Object.freeze({
  Idle: 0,
  ReadingPose: 1,
  EnablingTorque: 2,
  ApplyingRotation: 3,
  Settling: 4,
  ReleasingTorque: 5,
} as const)

export type MotionPhase = (typeof MotionPhase)[keyof typeof MotionPhase]

export const MotionEffectKind = Object.freeze({
  None: 0,
  ReadRotation: 1,
  EnableTorque: 2,
  ApplyRotation: 3,
  ScheduleTorqueRelease: 4,
  ReleaseTorque: 5,
} as const)

export type MotionEffectKind = (typeof MotionEffectKind)[keyof typeof MotionEffectKind]

export type MotionControllerPose = {
  body: Pose
  eyes: {
    left: Pose
    right: Pose
  }
}

export type MotionEffectSlot = {
  kind: MotionEffectKind
  targetRotation: Rotation
  durationSeconds: number
  settleDelayMs: number
  torque: boolean
  stopPolling: boolean
}

export type GazeTrackingOptions = {
  pose?: MotionControllerPose
  sampleMotionDuration?: () => number
}

function defaultMotionDuration(): number {
  return randomBetween(DEFAULT_MIN_MOTION_SECONDS, DEFAULT_MAX_MOTION_SECONDS)
}

export function createDefaultMotionPose(): MotionControllerPose {
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

function createEffectSlot(): MotionEffectSlot {
  return {
    kind: MotionEffectKind.None,
    targetRotation: { y: 0, p: 0, r: 0 },
    durationSeconds: 0,
    settleDelayMs: 0,
    torque: false,
    stopPolling: false,
  }
}

export class GazeTrackingAggregate {
  #phase: MotionPhase = MotionPhase.Idle
  #pose: MotionControllerPose
  #gazePoint: Vector3 | null = null
  #pendingMotionTime = 0
  #readingWhileMoving = false
  #relativeGazePoint: Vector3 = [0, 0, 0]
  #relativeGazeRotation: Rotation = { y: 0, p: 0, r: 0 }
  #effect: MotionEffectSlot = createEffectSlot()
  #sampleMotionDuration: () => number

  constructor(options: GazeTrackingOptions = {}) {
    this.#pose = options.pose ?? createDefaultMotionPose()
    this.#sampleMotionDuration = options.sampleMotionDuration ?? defaultMotionDuration
  }

  get phase(): MotionPhase {
    return this.#phase
  }

  get pose(): MotionControllerPose {
    return this.#pose
  }

  get gazePoint(): Vector3 | null {
    return this.#gazePoint
  }

  get isMoving(): boolean {
    return (
      this.#phase === MotionPhase.EnablingTorque ||
      this.#phase === MotionPhase.ApplyingRotation ||
      this.#phase === MotionPhase.Settling ||
      this.#phase === MotionPhase.ReleasingTorque
    )
  }

  get isUpdating(): boolean {
    return (
      this.#readingWhileMoving ||
      this.#phase === MotionPhase.ReadingPose ||
      this.#phase === MotionPhase.EnablingTorque ||
      this.#phase === MotionPhase.ApplyingRotation
    )
  }

  get shouldStopPolling(): boolean {
    return this.#gazePoint == null && !this.isMoving
  }

  setGazePoint(point: Vector3 | null): void {
    this.#gazePoint = point
  }

  requestPoll(isPaused = false): MotionEffectSlot {
    if (isPaused) {
      return this.#noneEffect(false)
    }
    if (this.#phase === MotionPhase.Idle) {
      this.#phase = MotionPhase.ReadingPose
      this.#effect.kind = MotionEffectKind.ReadRotation
      this.#effect.stopPolling = false
      return this.#effect
    }
    if (
      (this.#phase === MotionPhase.Settling || this.#phase === MotionPhase.ReleasingTorque) &&
      !this.#readingWhileMoving
    ) {
      this.#readingWhileMoving = true
      this.#effect.kind = MotionEffectKind.ReadRotation
      this.#effect.stopPolling = false
      return this.#effect
    }
    return this.#noneEffect(false)
  }

  onRotationSampled(result: Maybe<Rotation>, temporaryMotionActive = false): MotionEffectSlot {
    if (result.success) {
      const bodyRotation = this.#pose.body.rotation
      bodyRotation.y = result.value.y
      bodyRotation.p = result.value.p
      bodyRotation.r = result.value.r
    }

    if (this.#readingWhileMoving) {
      this.#readingWhileMoving = false
      return this.#noneEffect(this.shouldStopPolling)
    }

    if (this.#phase !== MotionPhase.ReadingPose) {
      return this.#noneEffect(this.shouldStopPolling)
    }

    const gazePoint = this.#gazePoint
    if (!temporaryMotionActive && gazePoint != null) {
      writeBodyRelativeVector3(this.#relativeGazePoint, gazePoint, this.#pose.body.rotation)
      writeRotationFromVector3(this.#relativeGazeRotation, this.#relativeGazePoint)
      const y = this.#relativeGazeRotation.y
      const p = this.#relativeGazeRotation.p
      if (y > GAZE_THRESHOLD || y < -GAZE_THRESHOLD || p > GAZE_THRESHOLD || p < -GAZE_THRESHOLD) {
        this.#pendingMotionTime = this.#sampleMotionDuration()
        writeRotationFromVector3(this.#effect.targetRotation, gazePoint)
        this.#effect.durationSeconds = this.#pendingMotionTime
        this.#effect.settleDelayMs = 0
        this.#effect.torque = true
        this.#effect.stopPolling = false
        this.#effect.kind = MotionEffectKind.EnableTorque
        this.#phase = MotionPhase.EnablingTorque
        return this.#effect
      }
    }

    this.#phase = MotionPhase.Idle
    return this.#noneEffect(this.#gazePoint == null)
  }

  onTorqueEnabled(): MotionEffectSlot {
    if (this.#phase !== MotionPhase.EnablingTorque) {
      return this.#noneEffect(this.shouldStopPolling)
    }
    this.#phase = MotionPhase.ApplyingRotation
    this.#effect.kind = MotionEffectKind.ApplyRotation
    this.#effect.durationSeconds = this.#pendingMotionTime
    this.#effect.stopPolling = false
    return this.#effect
  }

  onMotionApplied(): MotionEffectSlot {
    if (this.#phase !== MotionPhase.ApplyingRotation) {
      return this.#noneEffect(this.shouldStopPolling)
    }
    this.#phase = MotionPhase.Settling
    this.#effect.kind = MotionEffectKind.ScheduleTorqueRelease
    this.#effect.settleDelayMs = this.#pendingMotionTime * 1000 + SETTLE_MARGIN_MS
    this.#effect.stopPolling = false
    return this.#effect
  }

  onSettleElapsed(torqueRequested = false): MotionEffectSlot {
    if (this.#phase !== MotionPhase.Settling) {
      return this.#noneEffect(this.shouldStopPolling)
    }
    this.#phase = MotionPhase.ReleasingTorque
    this.#effect.kind = MotionEffectKind.ReleaseTorque
    this.#effect.torque = torqueRequested
    this.#effect.stopPolling = false
    return this.#effect
  }

  onTorqueReleased(): MotionEffectSlot {
    if (this.#phase !== MotionPhase.ReleasingTorque) {
      return this.#noneEffect(this.shouldStopPolling)
    }
    this.#phase = MotionPhase.Idle
    this.#pendingMotionTime = 0
    return this.#noneEffect(this.#gazePoint == null)
  }

  onPoseReadError(): MotionEffectSlot {
    if (this.#readingWhileMoving) {
      this.#readingWhileMoving = false
      return this.#noneEffect(this.shouldStopPolling)
    }
    if (this.#phase === MotionPhase.ReadingPose) {
      this.#phase = MotionPhase.Idle
      return this.#noneEffect(this.#gazePoint == null)
    }
    return this.#noneEffect(this.shouldStopPolling)
  }

  onError(): MotionEffectSlot {
    this.#phase = MotionPhase.Idle
    this.#readingWhileMoving = false
    this.#pendingMotionTime = 0
    return this.#noneEffect(this.#gazePoint == null)
  }

  reset(): void {
    this.#phase = MotionPhase.Idle
    this.#readingWhileMoving = false
    this.#pendingMotionTime = 0
    this.#noneEffect(false)
  }

  #noneEffect(stopPolling: boolean): MotionEffectSlot {
    this.#effect.kind = MotionEffectKind.None
    this.#effect.stopPolling = stopPolling
    return this.#effect
  }
}
