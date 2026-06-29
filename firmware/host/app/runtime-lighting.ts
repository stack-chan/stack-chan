import type Led from 'led'

export type RuntimeLightingConstructorParam = {
  led?: Record<string, Led>
}

export class StackchanRuntimeLighting {
  #led: Record<string, Led>

  constructor(params: RuntimeLightingConstructorParam) {
    this.#led = params.led ?? {}
  }

  get led() {
    return this.#led
  }

  lightOn(ledName: string, r: number, g: number, b: number, duration?: number, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      led.on(r, g, b, duration, index, count)
    }
  }

  lightOff(ledName: string, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      led.off(index, count)
    }
  }

  lightBlink(ledName: string, r: number, g: number, b: number, duration: number, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      led.blink(r, g, b, duration, index, count)
    }
  }

  lightRainbow(ledName: string, index?: number, count?: number) {
    const led = this.#led[ledName]
    if (led) {
      led.rainbow(index, count)
    }
  }
}
