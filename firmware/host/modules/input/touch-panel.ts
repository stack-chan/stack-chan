import { createTouchPanelInputEvent, type TouchPanelInputEvent } from 'input-event'
import Time from 'time'
import Timer from 'timer'
import {
  GestureRecognizer,
  type TouchPanelGesture,
  type TouchPanelGestureRecognizerOptions,
  type TouchPanelGestureType,
  type TouchPanelSample,
} from 'touch-panel-gesture'

type TouchPanelDriver = {
  sample: () => TouchPanelSample
  configure?: (options: unknown) => void
  close?: () => void
}

type TouchPanelConstructor = new (options: unknown) => TouchPanelDriver

type TouchPanelOptions = TouchPanelGestureRecognizerOptions & {
  interval?: number
  channels?: number
  sensitivityType?: number
  sensitivityLevel?: number
}

export default class TouchPanel {
  #driver: TouchPanelDriver
  #timer: Timer | undefined
  #recognizer: GestureRecognizer
  #interval: number
  #sampleErrorReported = false
  #lastSample: TouchPanelSample = []
  onEvent: (event: TouchPanelInputEvent) => void

  constructor(TouchPanelConstructor: TouchPanelConstructor, options: TouchPanelOptions = {}) {
    trace('[TouchPanel] constructor: instantiating\n')
    this.#recognizer = new GestureRecognizer(options)
    const driverOptions = {
      channels: options.channels ?? 3,
      ...(options.sensitivityType !== undefined && { sensitivityType: options.sensitivityType }),
      sensitivityLevel: options.sensitivityLevel ?? 3,
    }
    this.#driver = new TouchPanelConstructor(driverOptions)
    this.#interval = options.interval ?? 50
  }

  #sample(): TouchPanelSample {
    this.#lastSample = this.#driver.sample()
    return this.#lastSample
  }

  configure(options: TouchPanelOptions): void {
    if (options.interval !== undefined) {
      this.#interval = options.interval
      if (this.#timer) {
        this.stop()
        this.start()
      }
    }
    this.#driver.configure?.(options)
  }

  start(): void {
    if (this.#timer) return
    trace(`[TouchPanel] start interval=${this.#interval}ms\n`)
    this.#timer = Timer.repeat(() => {
      const ticks = Time.ticks
      let sample: TouchPanelSample
      try {
        sample = this.#sample()
        this.#sampleErrorReported = false
      } catch (error) {
        if (!this.#sampleErrorReported) {
          trace(`[TouchPanel] sample error ${errorMessage(error)}\n`)
          this.#sampleErrorReported = true
        }
        return
      }

      const gesture = this.#recognizer.update(sample, ticks)
      if (gesture) {
        const intensity = Math.max(sample[0] ?? 0, sample[1] ?? 0, sample[2] ?? 0)
        this.onEvent?.(createTouchPanelInputEvent(gesture.type, this.#recognizer.getPosition(sample), intensity, ticks))
      }
    }, this.#interval)
  }

  stop(): void {
    if (this.#timer) {
      trace('[TouchPanel] stop\n')
      Timer.clear(this.#timer)
      this.#timer = undefined
    }
  }

  close(): void {
    this.stop()
    this.#driver.close?.()
  }
}

export { GestureRecognizer, type TouchPanelGesture, type TouchPanelGestureType, type TouchPanelSample }

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}
