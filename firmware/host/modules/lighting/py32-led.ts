import {
  normalizeLedRange,
  PY32_LED_MAX_COUNT,
  type PY32IOExpander,
  tryGetSharedPY32IOExpander,
} from 'py32-io-expander'
import Timer from 'timer'

export default class PY32Led {
  length: number
  #offTimer?: Timer
  #blinkTimer?: Timer
  #rainbowTimer?: Timer
  #expander?: PY32IOExpander

  constructor(parameters: { length?: number; ledPin?: number; address?: number }) {
    this.length = Math.max(1, Math.min(PY32_LED_MAX_COUNT, parameters.length ?? 12))
    const expander = tryGetSharedPY32IOExpander(
      parameters.address === undefined ? undefined : { address: parameters.address },
      (error) => trace(`[py32-led] init failed: ${error}\n`),
    )
    if (!expander) return
    this.#expander = expander
    const ledPin = parameters.ledPin ?? 13
    expander.setDirection(ledPin, true)
    expander.setPullMode(ledPin, true)
    expander.setDriveMode(ledPin, false)
    expander.setLedCount(this.length)
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
    const expander = this.#expander
    if (!expander) return
    const { start, end } = normalizeLedRange(this.length, index, count)
    for (let i = start; i < end; i++) {
      expander.setLedColor(i, r, g, b)
    }
    expander.refreshLeds()
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
    if (!this.#expander) return
    let enabled = false
    const period = Math.max(50, Math.trunc(duration / 2))
    this.#blinkTimer = Timer.repeat(() => {
      enabled = !enabled
      this.#fill(enabled ? r : 0, enabled ? g : 0, enabled ? b : 0, index, count)
    }, period)
  }

  rainbow(index?: number, count?: number) {
    this.#stopEffect()
    const expander = this.#expander
    if (!expander) return
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
        expander.setLedColor(i, r, g, b)
      }
      expander.refreshLeds()
      offset = (offset + 1) % colors.length
    }, 100)
  }
}
