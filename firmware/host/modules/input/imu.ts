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
      const sample = this.#sample()
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

export { type IMUSample, type IMUVector3, MotionRecognizer, type MotionType }
