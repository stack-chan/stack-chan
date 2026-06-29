import { getSharedPY32IOExpander, normalizeLedRange, PY32_LED_MAX_COUNT } from 'py32-io-expander'
import Timer from 'timer'

export default class PY32Led {
  length: number
  #offTimer?: Timer
  #blinkTimer?: Timer
  #rainbowTimer?: Timer
  #expander: ReturnType<typeof getSharedPY32IOExpander>

  constructor(parameters: { length?: number; ledPin?: number; address?: number }) {
    this.#expander = getSharedPY32IOExpander(
      parameters.address === undefined ? undefined : { address: parameters.address },
    )
    this.length = Math.max(1, Math.min(PY32_LED_MAX_COUNT, parameters.length ?? 12))
    const ledPin = parameters.ledPin ?? 13
    this.#expander.setDirection(ledPin, true)
    this.#expander.setPullMode(ledPin, true)
    this.#expander.setDriveMode(ledPin, false)
    this.#expander.setLedCount(this.length)
    this.off()
  }

  #stopEffect() {
    if (this.#offTimer) {
      Timer.clear(this.#offTimer)
      this.#offTimer = undefined
    }
    if (this.#blinkTimer) {
      Timer.clear(this.#blinkTimer)
      this.#blinkTimer = undefined
    }
    if (this.#rainbowTimer) {
      Timer.clear(this.#rainbowTimer)
      this.#rainbowTimer = undefined
    }
  }

  #fill(r: number, g: number, b: number, index?: number, count?: number) {
    const { start, end } = normalizeLedRange(this.length, index, count)
    for (let i = start; i < end; i++) {
      this.#expander.setLedColor(i, r, g, b)
    }
    this.#expander.refreshLeds()
  }

  on(r: number, g: number, b: number, duration?: number, index?: number, count?: number) {
    this.#stopEffect()
    this.#fill(r, g, b, index, count)
    if (duration) {
      this.#offTimer = Timer.set(() => this.off(index, count), duration)
    }
  }

  off(index?: number, count?: number) {
    this.#stopEffect()
    this.#fill(0, 0, 0, index, count)
  }

  blink(r: number, g: number, b: number, duration: number, index?: number, count?: number) {
    this.#stopEffect()
    let enabled = false
    const period = Math.max(50, Math.trunc(duration / 2))
    this.#blinkTimer = Timer.repeat(() => {
      enabled = !enabled
      this.#fill(enabled ? r : 0, enabled ? g : 0, enabled ? b : 0, index, count)
    }, period)
  }

  rainbow(index?: number, count?: number) {
    this.#stopEffect()
    const colors = [
      [255, 0, 0],
      [255, 128, 0],
      [255, 255, 0],
      [0, 255, 0],
      [0, 64, 255],
      [96, 0, 255],
    ] as const
    let offset = 0
    this.#rainbowTimer = Timer.repeat(() => {
      const { start, end } = normalizeLedRange(this.length, index, count)
      for (let i = start; i < end; i++) {
        const [r, g, b] = colors[(i + offset) % colors.length]
        this.#expander.setLedColor(i, r, g, b)
      }
      this.#expander.refreshLeds()
      offset = (offset + 1) % colors.length
    }, 100)
  }
}
