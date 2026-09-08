import { createTouchInputEvent, type TouchInputEvent } from 'input-event'
import Time from 'time'
import Timer from 'timer'

type TouchPoint = {
  id: number
  x: number
  y: number
}

type TrackedPoint = {
  x: number
  y: number
}

type TouchDriver = {
  configuration?: {
    interrupt?: unknown
  }
  close?: () => void
  points: unknown[]
  sample: () => TouchPoint[] | undefined
  timer?: ReturnType<typeof Timer.set>
}

export type TouchOptions = {
  count?: number
  intervalMs?: number
  idleIntervalMs?: number
  activeIntervalMs?: number
  releaseDebounceMs?: number
}

export default class Touch {
  #touch: TouchDriver
  #releaseTimer: ReturnType<typeof Timer.set> | undefined
  #closed = false
  onEvent?: (event: TouchInputEvent) => void

  constructor(TouchConstructor: new (param: unknown) => TouchDriver, options: TouchOptions = {}) {
    trace('[Touch] constructor: instantiating\n')
    const touchCount = normalizeCount(options.count)
    const releaseDebounceMs = normalizeInterval(options.releaseDebounceMs, 0)
    const clearPendingRelease = () => this.#clearPendingRelease()
    const hasActiveTouch = (mask: number) => {
      const points = this.#touch.points as Array<TrackedPoint | undefined>
      for (let i = 0; mask; i += 1, mask >>= 1) {
        if (mask & 1 && points[i]) return true
      }
      return false
    }
    const emitEnded = (mask: number) => {
      if (this.#closed) return
      clearPendingRelease()
      const touch = this.#touch
      const trackedPoints = touch.points as Array<TrackedPoint | undefined>
      for (let i = 0; mask; i += 1, mask >>= 1) {
        if (mask & 1) {
          const last = trackedPoints[i]
          if (last) {
            trackedPoints[i] = undefined
            this.onEvent?.(createTouchInputEvent('ended', i, last.x, last.y, Time.ticks))
          }
        }
      }
    }
    const onSample = () => {
      if (this.#closed || !this.#touch) return
      const touch = this.#touch
      const points = touch.sample()
      if (!points) return

      let mask = (1 << touchCount) - 1
      for (let i = 0, length = points.length; i < length; i++) {
        const point = points[i]
        const id = point.id
        const trackedPoints = touch.points as Array<TrackedPoint | undefined>
        const last = trackedPoints[id]

        mask ^= 1 << id
        clearPendingRelease()
        // this.rotate?.(point);
        if (last) {
          last.x = point.x
          last.y = point.y
          this.onEvent?.(createTouchInputEvent('moved', id, point.x, point.y, Time.ticks))
        } else {
          trackedPoints[id] = { x: point.x, y: point.y }
          this.onEvent?.(createTouchInputEvent('began', id, point.x, point.y, Time.ticks))
        }
      }

      if (!mask) return

      if (releaseDebounceMs && 0 === points.length && hasActiveTouch(mask)) {
        clearPendingRelease()
        this.#releaseTimer = Timer.set(() => emitEnded(mask), releaseDebounceMs)
        return
      }

      emitEnded(mask)
    }
    const touch = new TouchConstructor({ onSample })
    this.#touch = touch
    try {
      if (typeof touch.sample !== 'function') throw new Error('Touch driver requires sample()')
      // ECMA-419 driver
      touch.points = new Array<TrackedPoint | undefined>(touchCount)
      const defaultInterval = normalizeInterval(options.intervalMs, 16)
      const idleInterval = normalizeInterval(options.idleIntervalMs, defaultInterval)
      const activeInterval = normalizeInterval(options.activeIntervalMs, idleInterval)
      trace(
        `[Touch] ECMA-419 sample() detected. interrupt=${Boolean(touch.configuration?.interrupt)} idle=${idleInterval}ms active=${activeInterval}ms\n`,
      )
      if (!touch.configuration?.interrupt) {
        trace('[Touch] ECMA-419 polling enabled\n')
        const poll = () => {
          if (this.#closed) return
          onSample()
          if (touch.timer) {
            Timer.schedule(
              touch.timer,
              hasTrackedPoint(touch.points as Array<TrackedPoint | undefined>) ? activeInterval : idleInterval,
            )
          }
        }
        touch.timer = Timer.set(poll, idleInterval)
      }
    } catch (error) {
      try {
        this.close()
      } catch (cleanupError) {
        trace(`[Touch] cleanup failed: ${String(cleanupError)}\n`)
      }
      throw error
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.onEvent = undefined
    try {
      this.#clearPendingRelease()
      if (this.#touch.timer) {
        Timer.clear(this.#touch.timer)
        this.#touch.timer = undefined
      }
    } finally {
      this.#touch.close?.()
    }
  }

  #clearPendingRelease(): void {
    if (!this.#releaseTimer) return
    Timer.clear(this.#releaseTimer)
    this.#releaseTimer = undefined
  }
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, value | 0) : 1
}

function normalizeInterval(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback
}

function hasTrackedPoint(points: Array<TrackedPoint | undefined>): boolean {
  for (const point of points) {
    if (point) return true
  }
  return false
}
