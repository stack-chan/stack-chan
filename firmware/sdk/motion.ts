import type { OperationOptions } from 'stackchan/task'

/** Yaw turns left; negative pitch looks up. Angles are relative to the calibrated neutral pose. */
export type MotionTarget = { yawDeg: number; pitchDeg: number }
export type MotionResult = { completion: 'measured' | 'estimated' }
export type MotionOptions = OperationOptions & {
  durationMs: number
  timeoutMs?: number
  completion?: 'trajectory' | 'measured'
}
export type MotionInfo =
  | {
      readonly availability: 'native' | 'simulated'
      readonly feedback: 'measured' | 'estimated'
      readonly canRelax: boolean
      readonly yawDeg: readonly [number, number]
      readonly pitchDeg: readonly [number, number]
    }
  | { readonly availability: 'unavailable'; readonly reason: string }

export interface AppMotion {
  /** Last observed position, in degrees; undefined before the first motion sample. */
  readonly position?: MotionTarget
  readonly info: MotionInfo
  /** Wait for the trajectory; measured devices additionally confirm arrival. */
  move(target: MotionTarget, options: MotionOptions): Promise<MotionResult>
  /** Keep a gaze target. Foreground moves temporarily take priority, then restore this target. */
  lookAt(target: MotionTarget): void
  lookAway(): void
  /** Cancel moves and gaze, then hold the measured or last commanded position. */
  stop(): Promise<void>
  /** Cancel motion, wait for the stop, then release torque when the driver supports it. */
  relax(): Promise<void>
}
