import {
  type IMUSample,
  type IMUVector3,
  MotionRecognizer,
  type MotionRecognizerOptions,
  type MotionType,
} from 'imu-motion'
import { createIMUInputEvent, type IMUInputEvent } from 'input-event'
import Time from 'time'
import Timer from 'timer'

export type IMUOptions = MotionRecognizerOptions & {
  interval?: number
}

type IMUDriver = {
  sample: () => IMUSample
  configure?: (options: unknown) => void
  close?: () => void
}

type IMUConstructor = new (options: unknown) => IMUDriver

export default class IMU {
  #driver: IMUDriver
  #timer: Timer | undefined
  #recognizer: MotionRecognizer
  #interval: number
  #lastSample: IMUSample = {}
  #sampleErrorReported = false
  onEvent: (event: IMUInputEvent) => void

  constructor(IMUConstructor: IMUConstructor, options: IMUOptions = {}) {
    this.#recognizer = new MotionRecognizer(options)
    this.#driver = new IMUConstructor({})
    this.#interval = options.interval ?? 100
    this.#driver.configure?.({ order: 'zxy' })
  }

  #sample(): IMUSample {
    this.#lastSample = this.#driver.sample()
    return copySample(this.#lastSample)
  }

  start(): void {
    if (this.#timer) return
    this.#timer = Timer.repeat(() => {
      const ticks = Time.ticks
      let sample: IMUSample
      try {
        sample = this.#sample()
        this.#sampleErrorReported = false
      } catch (error) {
        // Transient I2C read failures (e.g. bus contention while the camera SCCB is active)
        // must not tear down the polling timer; skip this tick and keep going.
        if (!this.#sampleErrorReported) {
          trace(`[IMU] sample error ${errorMessage(error)}\n`)
          this.#sampleErrorReported = true
        }
        return
      }
      const motion = this.#recognizer.update(sample, ticks)
      if (motion) this.onEvent?.(createIMUInputEvent(motion.type, ticks))
    }, this.#interval)
  }

  stop(): void {
    if (this.#timer) {
      Timer.clear(this.#timer)
      this.#timer = undefined
    }
  }

  close(): void {
    this.stop()
    this.#driver.close?.()
  }
}

function copySample(sample: IMUSample): IMUSample {
  return {
    ...(sample.accelerometer && { accelerometer: { ...sample.accelerometer } }),
    ...(sample.gyroscope && { gyroscope: { ...sample.gyroscope } }),
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export { type IMUSample, type IMUVector3, MotionRecognizer, type MotionType }
