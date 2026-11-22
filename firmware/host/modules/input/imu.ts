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
type SampleListener = (sample: IMUSample | undefined) => void

const SAMPLE_INTERVAL_MS = 25

export default class IMU {
  #driver: IMUDriver
  #timer: Timer | undefined
  #recognizer: MotionRecognizer
  #interval: number
  #samplingInterval?: number
  #recognizing = false
  #lastRecognitionAt?: number
  #sampleListeners = new Set<SampleListener>()
  #sampleErrorReported = false
  onEvent?: (event: IMUInputEvent) => void

  constructor(IMUConstructor: IMUConstructor, options: IMUOptions = {}) {
    this.#recognizer = new MotionRecognizer(options)
    this.#driver = new IMUConstructor({})
    this.#interval = options.interval ?? 100
    this.#driver.configure?.({ order: 'zxy' })
  }

  subscribeSamples(listener: SampleListener): () => void {
    this.#sampleListeners.add(listener)
    this.#scheduleSampling()
    return () => {
      this.#sampleListeners.delete(listener)
      this.#scheduleSampling()
    }
  }

  start(): void {
    if (this.#recognizing) return
    this.#recognizing = true
    this.#lastRecognitionAt = undefined
    this.#scheduleSampling()
  }

  stop(): void {
    this.#recognizing = false
    this.#scheduleSampling()
  }

  close(): void {
    this.#sampleListeners.clear()
    this.stop()
    this.#driver.close?.()
  }

  #scheduleSampling(): void {
    const interval = this.#sampleListeners.size
      ? Math.min(this.#interval, SAMPLE_INTERVAL_MS)
      : this.#recognizing
        ? this.#interval
        : undefined
    if (interval === this.#samplingInterval) return
    if (interval === undefined) {
      if (this.#timer !== undefined) Timer.clear(this.#timer)
      this.#timer = undefined
    } else if (this.#timer) {
      Timer.schedule(this.#timer, interval, interval)
    } else {
      this.#timer = Timer.repeat(this.#poll, interval)
    }
    this.#samplingInterval = interval
  }

  #poll = (): void => {
    const ticks = Time.ticks
    let sample: IMUSample | undefined
    try {
      sample = copySample(this.#driver.sample())
      this.#sampleErrorReported = false
    } catch (error) {
      // Camera SCCB can briefly contend for I2C. Keep polling after a failed read.
      if (!this.#sampleErrorReported) {
        trace(`[IMU] sample error ${errorMessage(error)}\n`)
        this.#sampleErrorReported = true
      }
    }
    if (
      sample &&
      this.#recognizing &&
      (this.#sampleListeners.size === 0 ||
        this.#lastRecognitionAt === undefined ||
        Time.delta(this.#lastRecognitionAt, ticks) >= this.#interval)
    ) {
      this.#lastRecognitionAt = ticks
      const motion = this.#recognizer.update(sample, ticks)
      if (motion) this.onEvent?.(createIMUInputEvent(motion.type, ticks))
    }
    for (const listener of this.#sampleListeners) {
      try {
        listener(sample)
      } catch (error) {
        trace(`[IMU] sample handler failed: ${errorMessage(error)}\n`)
      }
    }
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
