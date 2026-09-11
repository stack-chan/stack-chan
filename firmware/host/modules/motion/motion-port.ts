import type { MotionCompletion, MotionResultCallback } from 'motion-driver'
import type { MotionInfo } from 'stackchan/motion'
import type { Maybe, Rotation } from 'stackchan-util'

/** Callback-only, exclusive access for a host motion operation. Rotation remains in radians. */
export type MotionPort = {
  readonly info: MotionInfo
  readonly intervalMs: number
  /** Quiesce autonomous driver control, initialize, hold position, then enable torque. */
  prepare(done: MotionCompletion): void
  /** Read a fresh sample; estimated devices report their last commanded position. */
  read(done: MotionResultCallback<Maybe<Rotation>>): void
  /** Write an immediate position and complete after the driver has transmitted it. */
  write(rotation: Rotation, done: MotionCompletion): void
  /** End exclusive access. Driver background control may resume holding the last goal. */
  release(failure?: unknown): void
}

type DirectDriver = {
  setTorque(enabled: boolean, done?: MotionCompletion): void
  getRotation(done: MotionResultCallback<Maybe<Rotation>>): void
  applyRotation(rotation: Rotation, seconds?: number, done?: MotionCompletion): void
}

export function directMotionPort(driver: DirectDriver, info: MotionInfo, intervalMs = 50): MotionPort {
  Object.freeze(info)
  let active = false
  let generation = 0
  let failure: Error | undefined
  const unavailable = () => new Error('Motion access is not active')
  return {
    get info() {
      return failure ? { availability: 'unavailable' as const, reason: failure.message } : info
    },
    intervalMs,
    prepare: (done) => {
      if (failure || active) {
        done(failure ?? new Error('Motion access is already active'))
        return
      }
      active = true
      const version = ++generation
      driver.getRotation((sample) => {
        if (!active || version !== generation) return
        if (sample.success === false) {
          done(new Error(sample.reason ?? 'Cannot sample motion position'))
          return
        }
        const yaw = (sample.value.y * 180) / Math.PI
        const pitch = (sample.value.p * 180) / Math.PI
        if (
          info.availability === 'unavailable' ||
          !Number.isFinite(yaw) ||
          !Number.isFinite(pitch) ||
          yaw < info.yawDeg[0] - 1 ||
          yaw > info.yawDeg[1] + 1 ||
          pitch < info.pitchDeg[0] - 1 ||
          pitch > info.pitchDeg[1] + 1
        ) {
          done(new Error('Motion starts outside the calibrated range'))
          return
        }
        driver.applyRotation(sample.value, 0, (error) => {
          if (!active || version !== generation) return
          if (error != null) {
            done(error)
            return
          }
          driver.setTorque(true, (error) => {
            if (active && version === generation) done(error)
          })
        })
      })
    },
    read: (done) => {
      if (!active) {
        done({ success: false, reason: unavailable().message })
        return
      }
      const version = generation
      driver.getRotation((result) => {
        if (active && version === generation) done(result)
      })
    },
    write: (rotation, done) => {
      if (!active) {
        done(unavailable())
        return
      }
      const version = generation
      driver.applyRotation(rotation, 0, (error) => {
        if (active && version === generation) done(error)
      })
    },
    release(error) {
      active = false
      generation += 1
      if (error != null) failure = error instanceof Error ? error : new Error(String(error))
    },
  }
}

export function motionInfo(
  feedback: 'measured' | 'estimated',
  yaw: readonly [number, number],
  pitch: readonly [number, number],
  canRelax = true,
  availability: 'native' | 'simulated' = 'native',
): MotionInfo {
  return Object.freeze({
    availability,
    feedback,
    canRelax,
    yawDeg: Object.freeze([...yaw]) as readonly [number, number],
    pitchDeg: Object.freeze([...pitch]) as readonly [number, number],
  })
}
