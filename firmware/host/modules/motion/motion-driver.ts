import type { MotionPort } from 'motion-port'
import type { ServoMaintenancePort } from 'servo-maintenance'
import type { Maybe, Rotation as RotationType } from 'stackchan-util'

export type MotionDurationSeconds = number
export type ServoGoalTimeMilliseconds = number
export type ServoGoalTimeCentiseconds = number
export type MotionCompletion = (error?: unknown) => void
export type MotionResultCallback<T> = (result: T) => void

export type MotionDriver = {
  readonly maintenance?: ServoMaintenancePort
  readonly motion?: MotionPort
  applyRotation: (ori: RotationType, time?: MotionDurationSeconds, callback?: MotionCompletion) => void
  getRotation: (callback: MotionResultCallback<Maybe<RotationType>>) => void
  setTorque: (torque: boolean, callback?: MotionCompletion) => void
  onAttached?: () => void
  onDetached?: () => void
  close?: () => void
}

export function motionDurationSecondsToMilliseconds(duration: MotionDurationSeconds): ServoGoalTimeMilliseconds {
  return Math.max(0, Math.round(duration * 1000))
}

export function motionDurationSecondsToCentiseconds(duration: MotionDurationSeconds): ServoGoalTimeCentiseconds {
  return Math.max(0, Math.round(duration * 100))
}
