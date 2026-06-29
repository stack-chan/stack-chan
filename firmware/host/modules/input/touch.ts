import { createTouchInputEvent, type TouchInputEvent } from 'input-event'
import config from 'mc/config'
import Time from 'time'
import Timer from 'timer'

export default class Touch {
  // biome-ignore lint/suspicious/noExplicitAny: touch driver of device don't have type
  #touch: any
  onEvent: (event: TouchInputEvent) => void

  // biome-ignore lint/suspicious/noExplicitAny: touch driver of device don't have type
  constructor(TouchConstructor: new (param: unknown) => any) {
    trace('[Touch] constructor: instantiating\n')
    let touchCount = config.touchCount ?? 1
    const onSample = () => {
      const touch = this.#touch
      const points = touch.sample()
      if (!points) return

      let mask = (1 << touchCount) - 1
      for (let i = 0, length = points.length; i < length; i++) {
        const point = points[i]
        const id = point.id
        const last = touch.points[id]

        mask ^= 1 << id
        // this.rotate?.(point);
        if (last) {
          last.x = point.x
          last.y = point.y
          this.onEvent?.(createTouchInputEvent('moved', id, point.x, point.y, Time.ticks))
        } else {
          touch.points[id] = { x: point.x, y: point.y }
          this.onEvent?.(createTouchInputEvent('began', id, point.x, point.y, Time.ticks))
        }
      }

      for (let i = 0; mask; i += 1, mask >>= 1) {
        if (mask & 1) {
          const last = touch.points[i]
          if (last) {
            touch.points[i] = undefined
            this.onEvent?.(createTouchInputEvent('ended', i, last.x, last.y, Time.ticks))
          }
        }
      }
    }
    const touch = new TouchConstructor({ onSample })
    this.#touch = touch
    const configuredInterval = Number.isFinite(config.touchIntervalMs) ? config.touchIntervalMs : undefined
    if (touch.sample) {
      // ECMA-419 driver
      touch.points = new Array(touchCount)
      const interval = configuredInterval ?? 16
      trace(
        `[Touch] ECMA-419 sample() detected. interrupt=${Boolean(touch.configuration?.interrupt)} interval=${interval}ms\n`,
      )
      if (!touch.configuration?.interrupt) {
        trace('[Touch] ECMA-419 polling enabled\n')
        touch.timer = Timer.repeat(onSample, interval)
      }
    } else {
      // legacy driver
      trace('[Touch] legacy read() detected. polling enabled\n')
      touch.points = []
      while (touchCount--) touch.points.push({})
      const interval = configuredInterval ?? 15
      Timer.repeat(() => {
        const points = touch.points
        touch.read(points)
        const point = points[0]
        switch (point.state) {
          case 0:
          case 3:
            if (point.down) {
              point.down = undefined
              this.onEvent?.(createTouchInputEvent('ended', 0, point.x, point.y, Time.ticks))
              point.x = undefined
              point.y = undefined
            }
            break
          case 1:
          case 2:
            if (!point.down) {
              point.down = true
              this.onEvent?.(createTouchInputEvent('began', 0, point.x, point.y, Time.ticks))
            } else this.onEvent?.(createTouchInputEvent('moved', 0, point.x, point.y, Time.ticks))
            break
        }
      }, interval)
      trace(`[Touch] legacy polling interval=${interval}ms\n`)
    }
  }
}
