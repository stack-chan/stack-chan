import Time from 'time'
import Timer from 'timer'

export type IMUVector3 = {
  x: number
  y: number
  z: number
}

export type IMUSample = {
  accelerometer?: IMUVector3
  gyroscope?: IMUVector3
}

export type IMUOptions = {
  interval?: number
}

export type MotionType = 'shake'

type IMUDriver = {
  sample: () => IMUSample
  configure?: (options: unknown) => void
  close?: () => void
}

type IMUConstructor = new (options: unknown) => IMUDriver

export default class IMU {
  #driver: IMUDriver
  #timer: Timer | undefined
  #interval: number
  onSample: (sample: IMUSample, ticks: number) => void
  onMotionDetect: (type: MotionType) => void

  constructor(IMUConstructor: IMUConstructor, options: IMUOptions = {}) {
    this.#driver = new IMUConstructor({
      onWristGesture: () => this.onMotionDetect?.('shake'),
    })
    this.#interval = options.interval ?? 100
    this.#driver.configure?.({
      latched: 1,
      order: 'zxy',
      wristGesture: {
        enable: true,
        wearable_arm: 0,
        min_flick_peak: 1,
        min_flick_samples: 1,
        max_duration: 30,
      },
    })
  }

  start(): void {
    if (this.#timer) return
    this.#timer = Timer.repeat(() => {
      const ticks = Time.ticks
      const sample = this.#driver.sample()
      this.onSample?.(sample, ticks)
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
